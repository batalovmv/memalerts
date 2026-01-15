import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';

export const AI_STATUS = {
  pending: 'pending',
  processing: 'processing',
  done: 'done',
  failed: 'failed',
} as const;

export type AiStatus = (typeof AI_STATUS)[keyof typeof AI_STATUS];

export type AiQueueConfig = {
  maxAttempts: number;
  lockTtlMs: number;
  stuckMs: number;
};

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

export function resolveAiQueueConfig(): AiQueueConfig {
  const maxAttempts = clampInt(parseInt(String(process.env.AI_MAX_RETRIES || ''), 10), 0, 50, 5);
  const stuckMs = clampInt(
    parseInt(String(process.env.AI_MODERATION_STUCK_MS || ''), 10),
    5_000,
    7 * 24 * 60 * 60_000,
    10 * 60_000
  );
  const lockTtlMs = clampInt(
    parseInt(String(process.env.AI_LOCK_TTL_MS || ''), 10),
    5_000,
    30 * 60 * 60_000,
    8 * 60_000
  );
  return { maxAttempts, stuckMs, lockTtlMs };
}

export function getAiWorkerId(): string {
  const instance = String(process.env.INSTANCE || '').trim();
  if (instance) return instance.slice(0, 128);
  const host = String(process.env.HOSTNAME || process.env.COMPUTERNAME || '').trim();
  if (host) return `${host}-${process.pid}`.slice(0, 128);
  return `pid-${process.pid}`.slice(0, 128);
}

function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h >>> 0;
}

export function computeBackoffMs(attempt: number, jitterSeed?: string | null): number {
  // Exponential-ish backoff: 1m, 5m, 15m, 60m (cap) with +/-20% jitter.
  const schedule = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
  const idx = Math.max(0, Math.min(schedule.length - 1, attempt - 1));
  const base = schedule[idx] ?? 60 * 60_000;
  const jitterRatio = 0.2;
  if (!jitterRatio || base <= 0) return base;

  const seed = jitterSeed ? `${jitterSeed}:${attempt}` : '';
  const roll = seed ? fnv1a32(seed) / 0xffffffff : Math.random();
  const jitter = (roll * 2 - 1) * base * jitterRatio;
  return Math.max(1_000, Math.round(base + jitter));
}

export function computeAiFailureUpdate(opts: {
  prevAttempts: number;
  now: Date;
  errorMessage: string;
  maxAttempts: number;
  jitterSeed?: string | null;
}): {
  aiStatus: AiStatus;
  aiRetryCount: number;
  aiLastTriedAt: Date;
  aiProcessingStartedAt: Date | null;
  aiNextRetryAt: Date | null;
  aiError: string;
  aiLockedBy: string | null;
  aiLockExpiresAt: Date | null;
} {
  const { prevAttempts, now, errorMessage, maxAttempts, jitterSeed } = opts;
  const nextAttempt = Math.max(0, prevAttempts) + 1;
  const isFinal = nextAttempt >= maxAttempts && maxAttempts > 0;
  const backoffMs = isFinal ? null : computeBackoffMs(nextAttempt, jitterSeed);
  return {
    aiStatus: isFinal ? AI_STATUS.failed : AI_STATUS.pending,
    aiRetryCount: nextAttempt,
    aiLastTriedAt: now,
    aiProcessingStartedAt: null,
    aiNextRetryAt: isFinal ? null : new Date(now.getTime() + (backoffMs ?? 0)),
    aiError: errorMessage,
    aiLockedBy: null,
    aiLockExpiresAt: null,
  };
}

export async function enqueueAiForSubmission(
  submissionId: string,
  opts: { force?: boolean; reason?: string } = {}
): Promise<{ enqueued: boolean }> {
  const now = new Date();
  const { stuckMs } = resolveAiQueueConfig();
  const stuckBefore = new Date(Date.now() - stuckMs);
  const force = !!opts.force;
  const pendingCondition = force
    ? { aiStatus: 'pending' as const }
    : { aiStatus: 'pending' as const, OR: [{ aiNextRetryAt: null }, { aiNextRetryAt: { lte: now } }] };

  const res = await prisma.memeSubmission.updateMany({
    where: {
      id: submissionId,
      status: { in: ['pending', 'approved'] },
      sourceKind: { in: ['upload', 'url'] },
      OR: [
        pendingCondition,
        { aiStatus: 'failed' },
        {
          aiStatus: 'processing',
          OR: [{ aiLockExpiresAt: { lte: now } }, { aiLockExpiresAt: null }, { aiLastTriedAt: { lt: stuckBefore } }],
        },
      ],
    },
    data: {
      aiStatus: 'pending',
      aiNextRetryAt: null,
      aiLockedBy: null,
      aiLockExpiresAt: null,
    },
  });

  if (res.count > 0) {
    logger.info('ai.enqueue', { submissionId, reason: opts.reason ?? null, force });
  }

  return { enqueued: res.count > 0 };
}

export async function tryClaimAiSubmission(opts: {
  submissionId: string;
  workerId?: string;
  now?: Date;
  lockTtlMs?: number;
  stuckMs?: number;
  maxAttempts?: number;
}): Promise<{ claimed: boolean; workerId: string }> {
  const now = opts.now ?? new Date();
  const cfg = resolveAiQueueConfig();
  const lockTtlMs = opts.lockTtlMs ?? cfg.lockTtlMs;
  const stuckMs = opts.stuckMs ?? cfg.stuckMs;
  const maxAttempts = opts.maxAttempts ?? cfg.maxAttempts;
  const stuckBefore = new Date(Date.now() - stuckMs);
  const workerId = (opts.workerId || getAiWorkerId()).slice(0, 128);

  const res = await prisma.memeSubmission.updateMany({
    where: {
      id: opts.submissionId,
      status: { in: ['pending', 'approved'] },
      sourceKind: { in: ['upload', 'url'] },
      OR: [
        { aiStatus: 'pending', OR: [{ aiNextRetryAt: null }, { aiNextRetryAt: { lte: now } }] },
        {
          aiStatus: 'failed',
          aiRetryCount: { lt: maxAttempts },
          OR: [{ aiNextRetryAt: null }, { aiNextRetryAt: { lte: now } }],
        },
        {
          aiStatus: 'processing',
          OR: [{ aiLockExpiresAt: { lte: now } }, { aiLockExpiresAt: null }, { aiLastTriedAt: { lt: stuckBefore } }],
        },
      ],
    },
    data: {
      aiStatus: 'processing',
      aiLastTriedAt: now,
      aiProcessingStartedAt: now,
      aiLockedBy: workerId,
      aiLockExpiresAt: new Date(now.getTime() + Math.max(5_000, lockTtlMs)),
    },
  });

  if (res.count > 0) {
    logger.info('ai.lock_acquired', { submissionId: opts.submissionId, workerId, lockTtlMs });
  }

  return { claimed: res.count > 0, workerId };
}

export async function runAiWatchdogOnce(opts: { limit?: number } = {}): Promise<{
  stuckFound: number;
  recovered: number;
  pendingReady: number;
}> {
  const now = new Date();
  const cfg = resolveAiQueueConfig();
  const stuckBefore = new Date(Date.now() - cfg.stuckMs);
  const limit = clampInt(opts.limit ?? 100, 1, 5000, 500);

  const stuck = await prisma.memeSubmission.findMany({
    where: {
      status: { in: ['pending', 'approved'] },
      sourceKind: { in: ['upload', 'url'] },
      aiStatus: 'processing',
      OR: [{ aiLockExpiresAt: { lte: now } }, { aiLockExpiresAt: null }, { aiLastTriedAt: { lt: stuckBefore } }],
    },
    select: { id: true, aiRetryCount: true },
    take: limit,
    orderBy: { aiLastTriedAt: 'asc' },
  });

  let recovered = 0;
  for (const row of stuck) {
    const prevAttempts = typeof row.aiRetryCount === 'number' && Number.isFinite(row.aiRetryCount) ? row.aiRetryCount : 0;
    const update = computeAiFailureUpdate({
      prevAttempts,
      now,
      errorMessage: 'stuck_recovered',
      maxAttempts: cfg.maxAttempts,
      jitterSeed: row.id,
    });
    await prisma.memeSubmission.update({ where: { id: row.id }, data: update });
    recovered += 1;
    logger.warn('ai.stuck_recovered', { submissionId: row.id, nextStatus: update.aiStatus });
  }

  const pendingReady = await prisma.memeSubmission.count({
    where: {
      status: { in: ['pending', 'approved'] },
      sourceKind: { in: ['upload', 'url'] },
      aiStatus: 'pending',
      OR: [{ aiNextRetryAt: null }, { aiNextRetryAt: { lte: now } }],
    },
  });

  return { stuckFound: stuck.length, recovered, pendingReady };
}
