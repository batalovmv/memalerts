import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { logger } from '../src/utils/logger.js';
import { runAiWatchdogOnce } from '../src/jobs/aiQueue.js';

type MonitorResult = {
  warnings: number;
  errors: number;
};

function parseIntSafe(raw: unknown, fallback: number): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function addWarn(event: string, meta: Record<string, unknown>, state: MonitorResult) {
  state.warnings += 1;
  logger.warn(event, meta);
}

function addError(event: string, meta: Record<string, unknown>, state: MonitorResult) {
  state.errors += 1;
  logger.error(event, meta);
}

async function main() {
  const state: MonitorResult = { warnings: 0, errors: 0 };

  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since1h = new Date(now.getTime() - 60 * 60 * 1000);

  // AI watchdog: reuse existing logic (also recovers stuck items).
  const watchdogLimit = parseIntSafe(process.env.AI_WATCHDOG_LIMIT, 500);
  const watchdog = await runAiWatchdogOnce({ limit: watchdogLimit });
  if (watchdog.stuckFound > 10) {
    addWarn('monitor.ai_stuck_high', { stuckFound: watchdog.stuckFound, recovered: watchdog.recovered }, state);
  }

  // AI failures in the last 24h.
  const aiFailed24h = await prisma.memeSubmission.count({
    where: {
      aiStatus: 'failed',
      aiLastTriedAt: { gte: since24h },
    },
  });
  if (aiFailed24h > 50) {
    addError('monitor.ai_failed_high', { failedCount: aiFailed24h, windowHours: 24 }, state);
  }

  // Outbox backlog + failures per platform.
  const outboxPendingThreshold = 1000;
  const outboxFailureThreshold = 50;
  const pendingWhere = { status: { in: ['pending', 'processing'] } };
  const failedWhere = { status: 'failed' as const, failedAt: { gte: since1h } };

  const platformCounts = await Promise.all([
    prisma.chatBotOutboxMessage
      .count({ where: pendingWhere })
      .then((pending) =>
        prisma.chatBotOutboxMessage
          .count({ where: failedWhere })
          .then((failed) => ({ platform: 'twitch', pending, failed }))
      ),
    prisma.youTubeChatBotOutboxMessage
      .count({ where: pendingWhere })
      .then((pending) =>
        prisma.youTubeChatBotOutboxMessage
          .count({ where: failedWhere })
          .then((failed) => ({ platform: 'youtube', pending, failed }))
      ),
    prisma.vkVideoChatBotOutboxMessage
      .count({ where: pendingWhere })
      .then((pending) =>
        prisma.vkVideoChatBotOutboxMessage
          .count({ where: failedWhere })
          .then((failed) => ({ platform: 'vkvideo', pending, failed }))
      ),
    prisma.trovoChatBotOutboxMessage
      .count({ where: pendingWhere })
      .then((pending) =>
        prisma.trovoChatBotOutboxMessage
          .count({ where: failedWhere })
          .then((failed) => ({ platform: 'trovo', pending, failed }))
      ),
    prisma.kickChatBotOutboxMessage
      .count({ where: pendingWhere })
      .then((pending) =>
        prisma.kickChatBotOutboxMessage
          .count({ where: failedWhere })
          .then((failed) => ({ platform: 'kick', pending, failed }))
      ),
  ]);

  for (const row of platformCounts) {
    if (row.pending > outboxPendingThreshold) {
      addWarn(
        'monitor.outbox_backlog',
        { platform: row.platform, pendingCount: row.pending, threshold: outboxPendingThreshold },
        state
      );
    }
    if (row.failed > outboxFailureThreshold) {
      addWarn(
        'monitor.outbox_failures_rising',
        { platform: row.platform, failedCount: row.failed, windowMinutes: 60, threshold: outboxFailureThreshold },
        state
      );
    }
  }

  // Worker heartbeats.
  const heartbeats = await prisma.serviceHeartbeat.findMany();
  const nowMs = Date.now();
  for (const hb of heartbeats) {
    const ageMs = nowMs - hb.lastSeenAt.getTime();
    const status = ageMs <= 60_000 ? 'alive' : ageMs <= 5 * 60_000 ? 'stale' : 'dead';
    if (status !== 'alive') {
      addError(
        'monitor.worker_dead',
        { id: hb.id, status, lastSeenAt: hb.lastSeenAt.toISOString(), ageMs, meta: hb.meta ?? null },
        state
      );
    }
  }

  if (state.errors > 0) {
    process.exitCode = 2;
  } else if (state.warnings > 0) {
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}

main()
  .catch((e: unknown) => {
    const errorMessage = e instanceof Error ? e.message : String(e);
    logger.error('monitor.once_failed', { errorMessage });
    process.exitCode = 2;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
