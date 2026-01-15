import { Worker } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { processOneSubmission } from '../jobs/aiModerationSubmissions.js';
import {
  computeAiFailureUpdate,
  computeBackoffMs,
  getAiWorkerId,
  resolveAiQueueConfig,
  tryClaimAiSubmission,
} from '../jobs/aiQueue.js';
import { getBullmqConnection, getBullmqPrefix } from '../queues/bullmqConnection.js';
import {
  AI_MODERATION_QUEUE_NAME,
  enqueueAiModerationDlq,
} from '../queues/aiModerationQueue.js';

export type AiModerationWorkerHandle = {
  stop: (opts?: { timeoutMs?: number }) => Promise<void>;
};

let activeWorker: Worker | null = null;

function parseBool(raw: unknown): boolean {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return await p;
  let t: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        t = setTimeout(() => reject(new Error(`${label}_timeout_${ms}`)), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

export function startAiModerationWorker(): AiModerationWorkerHandle | null {
  const enabled = parseBool(process.env.AI_BULLMQ_ENABLED);
  if (!enabled) return null;

  const connection = getBullmqConnection();
  if (!connection) {
    logger.warn('ai.queue.redis_missing', {});
    return null;
  }

  const cfg = resolveAiQueueConfig();
  const workerId = getAiWorkerId();
  const perSubmissionTimeoutMs = clampInt(
    parseInt(String(process.env.AI_PER_SUBMISSION_TIMEOUT_MS || ''), 10),
    5_000,
    30 * 60_000,
    5 * 60_000
  );
  const concurrency = clampInt(parseInt(String(process.env.AI_BULLMQ_CONCURRENCY || ''), 10), 1, 20, 2);

  const worker = new Worker(
    AI_MODERATION_QUEUE_NAME,
    async (job) => {
      const submissionId = String(job.data?.submissionId || '').trim();
      if (!submissionId) {
        logger.warn('ai.queue.missing_submission_id', { jobId: job.id });
        return;
      }

      const now = new Date();
      const claim = await tryClaimAiSubmission({
        submissionId,
        workerId,
        now,
        lockTtlMs: cfg.lockTtlMs,
        stuckMs: cfg.stuckMs,
        maxAttempts: cfg.maxAttempts,
      });
      if (!claim.claimed) {
        logger.info('ai.queue.skip_not_claimed', { submissionId, jobId: job.id });
        return;
      }

      try {
        await withTimeout(processOneSubmission(submissionId), perSubmissionTimeoutMs, 'ai_submission');
        logger.info('ai.queue.done', { submissionId, jobId: job.id });
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error ?? 'ai_failed');
        const row = await prisma.memeSubmission.findUnique({
          where: { id: submissionId },
          select: { aiRetryCount: true },
        });
        const prevAttempts =
          typeof row?.aiRetryCount === 'number' && Number.isFinite(row.aiRetryCount) ? row.aiRetryCount : 0;
        const update = computeAiFailureUpdate({
          prevAttempts,
          now,
          errorMessage: errMsg,
          maxAttempts: cfg.maxAttempts,
          jitterSeed: submissionId,
        });
        await prisma.memeSubmission.update({ where: { id: submissionId }, data: update });
        logger.warn('ai.queue.failed', { submissionId, jobId: job.id, errorMessage: errMsg, nextStatus: update.aiStatus });

        if (update.aiStatus === 'failed') {
          await enqueueAiModerationDlq({
            submissionId,
            jobId: job.id ?? null,
            errorMessage: errMsg,
            attemptsMade: job.attemptsMade ?? prevAttempts,
            failedAt: new Date().toISOString(),
          });
        }

        throw error;
      }
    },
    {
      connection,
      prefix: getBullmqPrefix(),
      concurrency,
      settings: {
        backoffStrategy: (attemptsMade, _type, _err, job) => {
          const submissionId = typeof job?.data?.submissionId === 'string' ? job.data.submissionId : '';
          return computeBackoffMs(Math.max(1, attemptsMade), submissionId);
        },
      },
    }
  );

  worker.on('error', (err) => {
    const error = err as { message?: string };
    logger.error('ai.queue.worker_error', { errorMessage: error?.message || String(err) });
  });
  worker.on('failed', (job, err) => {
    logger.warn('ai.queue.job_failed', {
      submissionId: job?.data?.submissionId ?? null,
      jobId: job?.id ?? null,
      attemptsMade: job?.attemptsMade ?? null,
      errorMessage: err?.message || String(err),
    });
  });
  worker.on('completed', (job) => {
    logger.info('ai.queue.job_completed', { submissionId: job?.data?.submissionId ?? null, jobId: job?.id ?? null });
  });

  logger.info('ai.queue.worker_started', { workerId, concurrency });
  activeWorker = worker;

  return {
    stop: async (opts?: { timeoutMs?: number }) => {
      if (!activeWorker) return;
      const timeoutMs = opts?.timeoutMs;
      try {
        if (Number.isFinite(timeoutMs) && Number(timeoutMs) > 0) {
          await withTimeout(activeWorker.close(), Number(timeoutMs), 'ai_worker_close');
        } else {
          await activeWorker.close();
        }
      } finally {
        activeWorker = null;
      }
    },
  };
}
