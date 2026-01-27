import { Queue, type JobsOptions } from 'bullmq';
import { logger } from '../utils/logger.js';
import { getBullmqConnection, getBullmqPrefix } from './bullmqConnection.js';

export type ChatOutboxPlatform = 'twitch' | 'youtube' | 'vkvideo';

export const CHAT_OUTBOX_JOB_NAME = 'chat-outbox';

const QUEUE_NAMES: Record<ChatOutboxPlatform, string> = {
  twitch: 'chat-outbox-twitch',
  youtube: 'chat-outbox-youtube',
  vkvideo: 'chat-outbox-vkvideo',
};

export type ChatOutboxJobData = {
  platform: ChatOutboxPlatform;
  outboxId: string;
  channelId: string | null;
};

export function getChatOutboxQueueName(platform: ChatOutboxPlatform): string {
  return QUEUE_NAMES[platform];
}

let warnedDisabled = false;
let warnedAttempts = false;
const queues = new Map<ChatOutboxPlatform, Queue<ChatOutboxJobData>>();

function parseBool(raw: unknown): boolean {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function sanitizeJobId(value: string): string {
  return value.replace(/[:]/g, '-');
}

function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h >>> 0;
}

function resolveMaxAttempts(): number {
  const raw = parseInt(String(process.env.CHAT_OUTBOX_MAX_ATTEMPTS || ''), 10);
  const attempts = Number.isFinite(raw) ? Math.max(1, Math.min(20, raw)) : 5;
  if (raw <= 0 && !warnedAttempts) {
    warnedAttempts = true;
    logger.warn('chat.outbox.attempts.clamped', { configured: raw, effective: attempts });
  }
  return attempts;
}

export function computeChatOutboxBackoffMs(attempt: number, jitterSeed?: string | null): number {
  const schedule = [2_000, 10_000, 30_000, 120_000, 300_000];
  const idx = Math.max(0, Math.min(schedule.length - 1, attempt - 1));
  const base = schedule[idx] ?? 60_000;
  const jitterRatio = 0.2;
  const seed = jitterSeed ? `${jitterSeed}:${attempt}` : '';
  const roll = seed ? fnv1a32(seed) / 0xffffffff : Math.random();
  const jitter = (roll * 2 - 1) * base * jitterRatio;
  return Math.max(1_000, Math.round(base + jitter));
}

function isChatOutboxEnabled(): boolean {
  return parseBool(process.env.CHAT_OUTBOX_BULLMQ_ENABLED);
}

function resolveJobOptions(): JobsOptions {
  return {
    attempts: resolveMaxAttempts(),
    backoff: { type: 'custom' },
    removeOnComplete: true,
    removeOnFail: false,
  };
}

export function getChatOutboxQueue(platform: ChatOutboxPlatform): Queue<ChatOutboxJobData> | null {
  if (!isChatOutboxEnabled()) return null;
  const connection = getBullmqConnection();
  if (!connection) return null;
  const existing = queues.get(platform);
  if (existing) return existing;
  const queue = new Queue<ChatOutboxJobData>(QUEUE_NAMES[platform], {
    connection,
    prefix: getBullmqPrefix(),
  });
  queues.set(platform, queue);
  return queue;
}

export async function enqueueChatOutboxJob(opts: {
  platform: ChatOutboxPlatform;
  outboxId: string;
  channelId?: string | null;
}): Promise<{ enqueued: boolean; jobId: string | null }> {
  if (!isChatOutboxEnabled()) {
    if (!warnedDisabled) {
      warnedDisabled = true;
      logger.info('chat.outbox.queue_disabled_by_env', { platform: opts.platform });
    }
    return { enqueued: false, jobId: null };
  }
  const queue = getChatOutboxQueue(opts.platform);
  if (!queue) {
    logger.warn('chat.outbox.queue_disabled', { platform: opts.platform });
    return { enqueued: false, jobId: null };
  }

  const jobId = sanitizeJobId(opts.outboxId);
  const jobOptions: JobsOptions = {
    ...resolveJobOptions(),
    jobId,
  };

  try {
    await queue.add(
      CHAT_OUTBOX_JOB_NAME,
      {
        platform: opts.platform,
        outboxId: opts.outboxId,
        channelId: opts.channelId ?? null,
      },
      jobOptions
    );
    logger.info('chat.outbox.enqueued', { platform: opts.platform, outboxId: opts.outboxId, jobId });
    return { enqueued: true, jobId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Job') && message.toLowerCase().includes('exists')) {
      logger.info('chat.outbox.duplicate', { platform: opts.platform, outboxId: opts.outboxId, jobId });
      return { enqueued: false, jobId };
    }
    logger.warn('chat.outbox.enqueue_failed', {
      platform: opts.platform,
      outboxId: opts.outboxId,
      jobId,
      errorMessage: message,
    });
    return { enqueued: false, jobId };
  }
}

export async function getChatOutboxQueueCounts(platform: ChatOutboxPlatform): Promise<{
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
} | null> {
  const queue = getChatOutboxQueue(platform);
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
