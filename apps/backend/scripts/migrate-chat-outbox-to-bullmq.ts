import { prisma } from '../src/lib/prisma.js';
import { logger } from '../src/utils/logger.js';
import { type ChatOutboxPlatform, enqueueChatOutboxJob } from '../src/queues/chatOutboxQueue.js';

type OutboxRow = { id: string; channelId: string };

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

async function fetchBatch(platform: ChatOutboxPlatform, batch: number, staleBefore: Date): Promise<OutboxRow[]> {
  const baseOrder = { createdAt: 'asc' as const };
  if (platform === 'twitch') {
    return await prisma.chatBotOutboxMessage.findMany({
      where: {
        OR: [{ status: 'pending' }, { status: 'processing', processingAt: { lt: staleBefore } }],
      },
      select: { id: true, channelId: true },
      orderBy: baseOrder,
      take: batch,
    });
  }
  if (platform === 'youtube') {
    return await prisma.youTubeChatBotOutboxMessage.findMany({
      where: {
        OR: [{ status: 'pending' }, { status: 'processing', processingAt: { lt: staleBefore } }],
      },
      select: { id: true, channelId: true },
      orderBy: baseOrder,
      take: batch,
    });
  }
  if (platform === 'vkvideo') {
    return await prisma.vkVideoChatBotOutboxMessage.findMany({
      where: {
        OR: [{ status: 'pending' }, { status: 'processing', processingAt: { lt: staleBefore } }],
      },
      select: { id: true, channelId: true },
      orderBy: baseOrder,
      take: batch,
    });
  }
  if (platform === 'trovo') {
    return await prisma.trovoChatBotOutboxMessage.findMany({
      where: {
        OR: [{ status: 'pending' }, { status: 'processing', processingAt: { lt: staleBefore } }],
      },
      select: { id: true, channelId: true },
      orderBy: baseOrder,
      take: batch,
    });
  }
  const now = new Date();
  return await prisma.kickChatBotOutboxMessage.findMany({
    where: {
      OR: [
        { status: 'pending', nextAttemptAt: { lte: now } },
        { status: 'processing', processingAt: { lt: staleBefore } },
      ],
    },
    select: { id: true, channelId: true },
    orderBy: baseOrder,
    take: batch,
  });
}

async function migratePlatform(platform: ChatOutboxPlatform, batch: number, maxBatches: number, staleMs: number) {
  let totalEnqueued = 0;
  let batchCount = 0;

  for (;;) {
    const staleBefore = new Date(Date.now() - staleMs);
    const rows = await fetchBatch(platform, batch, staleBefore);
    if (rows.length === 0) break;

    let enqueued = 0;
    for (const row of rows) {
      const res = await enqueueChatOutboxJob({
        platform,
        outboxId: row.id,
        channelId: row.channelId,
      });
      if (res.enqueued) enqueued += 1;
    }

    totalEnqueued += enqueued;
    batchCount += 1;
    logger.info('chat.outbox.migration.batch', {
      platform,
      batch: batchCount,
      candidates: rows.length,
      enqueued,
      totalEnqueued,
    });

    if (rows.length < batch || batchCount >= maxBatches) break;
  }

  logger.info('chat.outbox.migration.completed', { platform, totalEnqueued, batches: batchCount });
}

async function main() {
  const batch = clampInt(parseInt(String(process.env.BATCH || ''), 10), 1, 1000, 200);
  const maxBatches = clampInt(parseInt(String(process.env.MAX_BATCHES || ''), 10), 1, 1000, 100);
  const staleMs = clampInt(
    parseInt(String(process.env.CHAT_OUTBOX_PROCESSING_STALE_MS || ''), 10),
    5_000,
    30 * 60_000,
    60_000
  );

  const platforms: ChatOutboxPlatform[] = ['twitch', 'youtube', 'vkvideo', 'trovo', 'kick'];
  for (const platform of platforms) {
    await migratePlatform(platform, batch, maxBatches, staleMs);
  }
}

main()
  .catch((e) => {
    logger.error('chat.outbox.migration.failed', { errorMessage: e instanceof Error ? e.message : String(e) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
