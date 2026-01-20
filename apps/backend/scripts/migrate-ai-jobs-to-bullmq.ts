import { prisma } from '../src/lib/prisma.js';
import { logger } from '../src/utils/logger.js';
import { resolveAiQueueConfig } from '../src/jobs/aiQueue.js';
import { enqueueAiModerationJob } from '../src/queues/aiModerationQueue.js';

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

async function main() {
  const batch = clampInt(parseInt(String(process.env.BATCH || ''), 10), 1, 1000, 200);
  const maxBatches = clampInt(parseInt(String(process.env.MAX_BATCHES || ''), 10), 1, 1000, 100);
  const cfg = resolveAiQueueConfig();

  let totalEnqueued = 0;
  let batchCount = 0;

  for (;;) {
    const now = new Date();
    const stuckBefore = new Date(Date.now() - cfg.stuckMs);
    const candidates = await prisma.memeSubmission.findMany({
      where: {
        status: { in: ['pending', 'approved'] },
        sourceKind: { in: ['upload', 'url'] },
        OR: [
          { aiStatus: 'pending', OR: [{ aiNextRetryAt: null }, { aiNextRetryAt: { lte: now } }] },
          {
            aiStatus: 'failed',
            aiRetryCount: { lt: cfg.maxAttempts },
            OR: [{ aiNextRetryAt: null }, { aiNextRetryAt: { lte: now } }],
          },
          {
            aiStatus: 'processing',
            OR: [{ aiLockExpiresAt: { lte: now } }, { aiLockExpiresAt: null }, { aiLastTriedAt: { lt: stuckBefore } }],
          },
        ],
      },
      select: { id: true },
      take: batch,
      orderBy: { createdAt: 'asc' },
    });

    if (candidates.length === 0) break;

    let enqueued = 0;
    for (const c of candidates) {
      const res = await enqueueAiModerationJob(c.id, { reason: 'migration' });
      if (res.enqueued) enqueued += 1;
    }

    totalEnqueued += enqueued;
    batchCount += 1;
    logger.info('ai.queue.migration.batch', {
      batch: batchCount,
      candidates: candidates.length,
      enqueued,
      totalEnqueued,
    });

    if (candidates.length < batch || batchCount >= maxBatches) break;
  }

  logger.info('ai.queue.migration.completed', { totalEnqueued, batches: batchCount });
}

main()
  .catch((e) => {
    logger.error('ai.queue.migration.failed', { errorMessage: e instanceof Error ? e.message : String(e) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
