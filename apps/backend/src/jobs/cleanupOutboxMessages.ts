import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { releaseAdvisoryLock, tryAcquireAdvisoryLock } from '../utils/pgAdvisoryLock.js';

type CleanupOptions = {
  /** Delete sent/failed outbox messages older than this many days. */
  ttlDays: number;
  /** Max rows per outbox table per run. */
  batchSize: number;
};

type CleanupResult = {
  scanned: number;
  deleted: number;
};

type OutboxModel = {
  findMany: (args: {
    where: { status: { in: string[] }; updatedAt: { lt: Date } };
    select: { id: true };
    take: number;
    orderBy: { updatedAt: 'asc' };
  }) => Promise<Array<{ id: string }>>;
  deleteMany: (args: { where: { id: { in: string[] } } }) => Promise<{ count: number }>;
};

const OUTBOX_MODELS: Array<{ name: string; model: OutboxModel }> = [
  { name: 'chatBotOutbox', model: prisma.chatBotOutboxMessage },
  { name: 'youTubeChatBotOutbox', model: prisma.youTubeChatBotOutboxMessage },
  { name: 'vkVideoChatBotOutbox', model: prisma.vkVideoChatBotOutboxMessage },
];

function daysToMs(days: number): number {
  return Math.max(0, days) * 24 * 60 * 60 * 1000;
}

async function cleanupOutboxModel(
  name: string,
  model: OutboxModel,
  cutoff: Date,
  batchSize: number
): Promise<CleanupResult> {
  const rows = await model.findMany({
    where: { status: { in: ['sent', 'failed'] }, updatedAt: { lt: cutoff } },
    select: { id: true },
    take: Math.max(1, Math.min(batchSize, 1000)),
    orderBy: { updatedAt: 'asc' },
  });
  if (rows.length === 0) return { scanned: 0, deleted: 0 };

  const ids = rows.map((row) => row.id);
  const deleted = await model.deleteMany({ where: { id: { in: ids } } });
  logger.info('cleanup.outbox.table_completed', { table: name, scanned: rows.length, deleted: deleted.count });
  return { scanned: rows.length, deleted: deleted.count };
}

export async function cleanupOutboxMessages(opts: CleanupOptions): Promise<CleanupResult> {
  const ttlDays = Number.isFinite(opts.ttlDays) ? opts.ttlDays : 14;
  const batchSize = Number.isFinite(opts.batchSize) ? opts.batchSize : 500;
  const cutoff = new Date(Date.now() - daysToMs(ttlDays));

  let scanned = 0;
  let deleted = 0;

  for (const entry of OUTBOX_MODELS) {
    const result = await cleanupOutboxModel(entry.name, entry.model, cutoff, batchSize);
    scanned += result.scanned;
    deleted += result.deleted;
  }

  return { scanned, deleted };
}

export function startOutboxCleanupScheduler() {
  const ttlDays = parseInt(process.env.CHAT_OUTBOX_CLEANUP_DAYS || '14', 10);
  const batchSize = parseInt(process.env.CHAT_OUTBOX_CLEANUP_BATCH || '500', 10);
  const intervalMs = parseInt(process.env.CHAT_OUTBOX_CLEANUP_INTERVAL_MS || String(24 * 60 * 60 * 1000), 10); // daily
  const initialDelayMs = parseInt(process.env.CHAT_OUTBOX_CLEANUP_INITIAL_DELAY_MS || String(10 * 60 * 1000), 10); // 10 min

  let running = false;
  // Ensure only one instance (prod or beta) runs cleanup on shared DB.
  const lockId = 777421n;

  const runOnce = async () => {
    if (running) return;
    running = true;
    const startedAt = Date.now();
    let locked = false;
    try {
      locked = await tryAcquireAdvisoryLock(lockId);
      if (!locked) return;
      const res = await cleanupOutboxMessages({
        ttlDays: Number.isFinite(ttlDays) ? ttlDays : 14,
        batchSize: Number.isFinite(batchSize) ? batchSize : 500,
      });
      logger.info('cleanup.outbox.completed', {
        ttlDays,
        batchSize,
        durationMs: Date.now() - startedAt,
        ...res,
      });
    } catch (error) {
      const err = error as Error;
      logger.error('cleanup.outbox.failed', {
        ttlDays,
        batchSize,
        durationMs: Date.now() - startedAt,
        errorMessage: err.message,
      });
    } finally {
      if (locked) await releaseAdvisoryLock(lockId);
      running = false;
    }
  };

  // Kick after a short delay, then run periodically.
  setTimeout(() => void runOnce(), Math.max(0, initialDelayMs));
  setInterval(() => void runOnce(), Math.max(60_000, intervalMs));
}
