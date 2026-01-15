import { prisma } from '../src/lib/prisma.js';
import { logger } from '../src/utils/logger.js';
import { processOneSubmission } from '../src/jobs/aiModerationSubmissions.js';
import { releaseAdvisoryLock, tryAcquireAdvisoryLock } from '../src/utils/pgAdvisoryLock.js';
import { computeAiFailureUpdate, resolveAiQueueConfig, tryClaimAiSubmission } from '../src/jobs/aiQueue.js';

/**
 * Manual AI analysis runner for pending submissions.
 *
 * Processes all submissions that need AI analysis:
 * - status: pending or approved
 * - sourceKind: upload or url
 * - aiStatus: pending, failed (with retry), or stuck processing
 *
 * Usage:
 *   pnpm tsx scripts/run-ai-analysis.ts
 *
 * Environment variables (optional):
 *   - BATCH: number of submissions to process per iteration (default: 25)
 *   - MAX_RETRIES: maximum retry attempts (default: 5)
 *   - PER_SUBMISSION_TIMEOUT_MS: timeout per submission (default: 300000 = 5min)
 *   - STUCK_MS: consider processing stuck after this time (default: 600000 = 10min)
 */

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function parseBool(raw: unknown): boolean {
  const v = String(raw ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h >>> 0;
}

function computeAiSchedulerLockId(): bigint {
  const base = 421399n;
  const key = `${process.env.INSTANCE || ''}|${process.cwd()}`;
  const h = fnv1a32(key);
  return base + BigInt(h % 100000);
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

async function main() {
  const batch = clampInt(parseInt(String(process.env.BATCH || ''), 10), 1, 500, 25);
  const defaultCfg = resolveAiQueueConfig();
  const maxAttempts = clampInt(parseInt(String(process.env.MAX_RETRIES || ''), 10), 0, 50, defaultCfg.maxAttempts);
  const stuckMs = clampInt(
    parseInt(String(process.env.STUCK_MS || ''), 10),
    5_000,
    7 * 24 * 60 * 60_000,
    defaultCfg.stuckMs
  );
  const lockTtlMs = defaultCfg.lockTtlMs;
  const perSubmissionTimeoutMs = clampInt(
    parseInt(String(process.env.PER_SUBMISSION_TIMEOUT_MS || ''), 10),
    5_000,
    30 * 60_000,
    5 * 60_000
  );

  const openaiApiKeySet = !!String(process.env.OPENAI_API_KEY || '').trim();
  if (!openaiApiKeySet) {
    logger.warn('ai_analysis.openai.disabled', { reason: 'OPENAI_API_KEY_not_set' });
    process.exitCode = 1;
    return;
  }

  logger.info('ai_analysis.start', {
    batch,
    maxAttempts,
    stuckMs,
    perSubmissionTimeoutMs,
  });

  const lockId = computeAiSchedulerLockId();
  const locked = await tryAcquireAdvisoryLock(lockId);
  if (!locked) {
    logger.warn('ai_analysis.lock_failed', { reason: 'another_process_running' });
    process.exitCode = 1;
    return;
  }

  try {
    let totalProcessed = 0;
    let totalClaimed = 0;
    let totalFailed = 0;
    let totalAutoApproved = 0;
    let iteration = 0;

    for (;;) {
      iteration++;
      const now = new Date();
      const stuckBefore = new Date(Date.now() - stuckMs);

      const candidates = await prisma.memeSubmission.findMany({
        where: {
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
              OR: [
                { aiLockExpiresAt: { lte: now } },
                { aiLockExpiresAt: null },
                { aiLastTriedAt: { lt: stuckBefore } },
              ],
            },
          ],
        },
        select: { id: true, aiStatus: true, aiRetryCount: true },
        take: batch,
        orderBy: { createdAt: 'asc' },
      });

      if (candidates.length === 0) {
        logger.info('ai_analysis.no_more_candidates', { iteration });
        break;
      }

      let processed = 0;
      let claimed = 0;
      let failed = 0;
      let autoApproved = 0;

      for (const c of candidates) {
        // Guard: permanent failure
        if ((c.aiRetryCount ?? 0) >= maxAttempts && maxAttempts > 0) {
          await prisma.memeSubmission.update({
            where: { id: c.id },
            data: {
              aiStatus: 'failed',
              aiError: 'max_attempts_exceeded',
              aiNextRetryAt: null,
              aiProcessingStartedAt: null,
              aiLockedBy: null,
              aiLockExpiresAt: null,
            },
          });
          continue;
        }

        const claim = await tryClaimAiSubmission({
          submissionId: c.id,
          now,
          lockTtlMs,
          stuckMs,
          maxAttempts,
        });
        if (!claim.claimed) continue;
        claimed += 1;
        totalClaimed += 1;

        try {
          await withTimeout(processOneSubmission(c.id), perSubmissionTimeoutMs, 'ai_submission');
          processed += 1;
          totalProcessed += 1;

          // Best-effort: detect auto-approve by checking submission status.
          if (parseBool(process.env.AI_LOW_AUTOPROVE_ENABLED)) {
            const s = await prisma.memeSubmission.findUnique({ where: { id: c.id }, select: { status: true } });
            if (s?.status === 'approved') {
              autoApproved += 1;
              totalAutoApproved += 1;
            }
          }
        } catch (e: unknown) {
          failed += 1;
          totalFailed += 1;
          const prevRetries =
            typeof c.aiRetryCount === 'number' && Number.isFinite(c.aiRetryCount) ? c.aiRetryCount : 0;
          const errorMessage = e instanceof Error ? e.message : 'ai_failed';
          const update = computeAiFailureUpdate({
            prevAttempts: prevRetries,
            now,
            errorMessage,
            maxAttempts,
            jitterSeed: c.id,
          });

          await prisma.memeSubmission.update({ where: { id: c.id }, data: update });
        }
      }

      logger.info('ai_analysis.iteration', {
        iteration,
        candidates: candidates.length,
        claimed,
        processed,
        failed,
        autoApproved,
        totalProcessed,
        totalFailed,
        totalAutoApproved,
      });

      // If we processed fewer than batch, we're done
      if (candidates.length < batch) {
        break;
      }
    }

    logger.info('ai_analysis.completed', {
      iterations: iteration,
      totalClaimed,
      totalProcessed,
      totalFailed,
      totalAutoApproved,
    });
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    const errorStack = e instanceof Error ? e.stack : undefined;
    logger.error('ai_analysis.failed', {
      errorMessage,
      errorStack,
    });
    process.exitCode = 1;
  } finally {
    await releaseAdvisoryLock(lockId);
  }
}

main()
  .catch((e) => {
    logger.error('ai_analysis.unhandled_error', { err: e instanceof Error ? e.message : String(e) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
