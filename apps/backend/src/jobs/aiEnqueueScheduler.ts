import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { enqueueAiModerationJob } from '../queues/aiModerationQueue.js';

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

/**
 * Periodically finds pending AI submissions that are not yet in the BullMQ queue
 * and enqueues them. This handles cases where:
 * 1. BullMQ was disabled when submissions were created
 * 2. Jobs failed and need retry
 * 3. Server restarted and queue was empty
 */
export async function enqueueReadyPendingSubmissions(opts?: { limit?: number }): Promise<{
  found: number;
  enqueued: number;
}> {
  const now = new Date();
  const limit = clampInt(opts?.limit ?? 50, 1, 500, 50);

  // Find submissions that are ready for AI processing
  const pending = await prisma.memeSubmission.findMany({
    where: {
      status: { in: ['pending', 'approved'] },
      sourceKind: { in: ['upload', 'url'] },
      aiStatus: 'pending',
      OR: [{ aiNextRetryAt: null }, { aiNextRetryAt: { lte: now } }],
    },
    select: { id: true },
    take: limit,
    orderBy: { createdAt: 'asc' },
  });

  let enqueued = 0;
  for (const row of pending) {
    const result = await enqueueAiModerationJob(row.id, { reason: 'scheduler_backfill' });
    if (result.enqueued) {
      enqueued += 1;
    }
  }

  if (enqueued > 0) {
    logger.info('ai.scheduler.enqueued', { found: pending.length, enqueued });
  }

  return { found: pending.length, enqueued };
}

let schedulerTimer: NodeJS.Timeout | null = null;

export function startAiEnqueueScheduler(): void {
  const intervalMsRaw = parseInt(String(process.env.AI_ENQUEUE_SCHEDULER_INTERVAL_MS || ''), 10);
  const intervalMs = Number.isFinite(intervalMsRaw) ? clampInt(intervalMsRaw, 10_000, 600_000, 60_000) : 60_000;
  const batchSize = clampInt(parseInt(String(process.env.AI_ENQUEUE_BATCH_SIZE || ''), 10), 1, 200, 50);

  const runOnce = async () => {
    try {
      await enqueueReadyPendingSubmissions({ limit: batchSize });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error ?? 'unknown');
      logger.error('ai.scheduler.error', { errorMessage: errMsg });
    }
  };

  // Run once at startup
  void runOnce();

  // Then run periodically
  schedulerTimer = setInterval(() => void runOnce(), intervalMs);

  logger.info('ai.scheduler.started', { intervalMs, batchSize });
}

export function stopAiEnqueueScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

