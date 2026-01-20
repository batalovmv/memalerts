import { Queue, type JobsOptions } from 'bullmq';
import { logger } from '../utils/logger.js';
import { getBullmqConnection, getBullmqPrefix } from './bullmqConnection.js';
import { resolveAiQueueConfig } from '../jobs/aiQueue.js';

export const AI_MODERATION_QUEUE_NAME = 'ai-moderation';
export const AI_MODERATION_DLQ_NAME = 'ai-moderation-dlq';
export const AI_MODERATION_JOB_NAME = 'ai-moderation';

export type AiModerationJobData = {
  submissionId: string;
  reason?: string | null;
};

type DlqPayload = {
  submissionId: string;
  jobId: string | null;
  errorMessage: string;
  attemptsMade: number;
  failedAt: string;
};

let aiModerationQueue: Queue<AiModerationJobData> | null = null;
let aiModerationDlq: Queue<DlqPayload> | null = null;
let warnedAttempts = false;
let warnedDisabled = false;

function parseBool(raw: unknown): boolean {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function sanitizeJobId(value: string): string {
  return value.replace(/[:]/g, '-');
}

function isBullmqEnabled(): boolean {
  return parseBool(process.env.AI_BULLMQ_ENABLED);
}

function resolveJobOptions(): JobsOptions {
  const cfg = resolveAiQueueConfig();
  const attempts = cfg.maxAttempts > 0 ? cfg.maxAttempts : 1;
  if (cfg.maxAttempts <= 0 && !warnedAttempts) {
    warnedAttempts = true;
    logger.warn('bullmq.attempts.clamped', { configured: cfg.maxAttempts, effective: attempts });
  }
  return {
    attempts,
    backoff: { type: 'custom' },
    removeOnComplete: true,
    removeOnFail: false,
  };
}

export function getAiModerationQueue(): Queue<AiModerationJobData> | null {
  if (!isBullmqEnabled()) return null;
  const connection = getBullmqConnection();
  if (!connection) return null;
  if (!aiModerationQueue) {
    aiModerationQueue = new Queue<AiModerationJobData>(AI_MODERATION_QUEUE_NAME, {
      connection,
      prefix: getBullmqPrefix(),
    });
  }
  return aiModerationQueue;
}

export function getAiModerationDlq(): Queue<DlqPayload> | null {
  if (!isBullmqEnabled()) return null;
  const connection = getBullmqConnection();
  if (!connection) return null;
  if (!aiModerationDlq) {
    aiModerationDlq = new Queue<DlqPayload>(AI_MODERATION_DLQ_NAME, {
      connection,
      prefix: getBullmqPrefix(),
    });
  }
  return aiModerationDlq;
}

export async function enqueueAiModerationJob(
  submissionId: string,
  opts: { reason?: string | null; delayMs?: number } = {}
): Promise<{ enqueued: boolean; jobId: string | null }> {
  if (!isBullmqEnabled()) {
    if (!warnedDisabled) {
      warnedDisabled = true;
      logger.info('ai.queue.disabled_by_env', { submissionId, reason: opts.reason ?? null });
    }
    return { enqueued: false, jobId: null };
  }
  const queue = getAiModerationQueue();
  if (!queue) {
    logger.warn('ai.queue.disabled', { submissionId, reason: opts.reason ?? null });
    return { enqueued: false, jobId: null };
  }

  const jobId = `ai-${sanitizeJobId(submissionId)}`;
  const jobOptions: JobsOptions = {
    ...resolveJobOptions(),
    jobId,
    delay: opts.delayMs && opts.delayMs > 0 ? Math.floor(opts.delayMs) : undefined,
  };

  try {
    await queue.add(AI_MODERATION_JOB_NAME, { submissionId, reason: opts.reason ?? null }, jobOptions);
    logger.info('ai.queue.enqueued', { submissionId, jobId, reason: opts.reason ?? null });
    return { enqueued: true, jobId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Job') && message.toLowerCase().includes('exists')) {
      logger.info('ai.queue.duplicate', { submissionId, jobId });
      return { enqueued: false, jobId };
    }
    logger.warn('ai.queue.enqueue_failed', { submissionId, jobId, errorMessage: message });
    return { enqueued: false, jobId };
  }
}

export async function enqueueAiModerationDlq(payload: DlqPayload): Promise<void> {
  const queue = getAiModerationDlq();
  if (!queue) {
    logger.warn('ai.queue.dlq_disabled', { submissionId: payload.submissionId, jobId: payload.jobId });
    return;
  }
  const safeFailedAt = sanitizeJobId(payload.failedAt.replace(/[.]/g, '-'));
  const jobId = `ai-dlq-${sanitizeJobId(payload.submissionId)}-${safeFailedAt}`;
  await queue.add('ai-moderation-dlq', payload, { jobId, removeOnComplete: true, removeOnFail: false });
}

export async function getAiModerationQueueCounts(): Promise<{
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
} | null> {
  const queue = getAiModerationQueue();
  if (!queue) return null;
  const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
    completed: counts.completed ?? 0,
  };
}

export async function getAiModerationDlqCounts(): Promise<{ failed: number } | null> {
  const queue = getAiModerationDlq();
  if (!queue) return null;
  const counts = await queue.getJobCounts('failed');
  return { failed: counts.failed ?? 0 };
}
