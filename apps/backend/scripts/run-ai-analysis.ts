import { prisma } from '../src/lib/prisma.js';
import { logger } from '../src/utils/logger.js';
import { processOneSubmission } from '../src/jobs/aiModerationSubmissions.js';
import { releaseAdvisoryLock, tryAcquireAdvisoryLock } from '../src/utils/pgAdvisoryLock.js';

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
  const maxRetries = clampInt(parseInt(String(process.env.MAX_RETRIES || ''), 10), 0, 50, 5);
  const stuckMs = clampInt(parseInt(String(process.env.STUCK_MS || ''), 10), 5_000, 7 * 24 * 60 * 60_000, 10 * 60_000);
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
    maxRetries,
    stuckMs,
    perSubmissionTimeoutMs,
  });

  const lockId = 421399n;
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
            { aiStatus: 'pending' },
            { aiStatus: 'failed', OR: [{ aiNextRetryAt: null }, { aiNextRetryAt: { lte: now } }] },
            { aiStatus: 'processing', aiLastTriedAt: { lt: stuckBefore } },
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
        if ((c.aiRetryCount ?? 0) >= maxRetries) {
          await prisma.memeSubmission.update({
            where: { id: c.id },
            data: {
              aiStatus: 'failed_final',
              aiError: 'max_retries_exceeded',
              aiNextRetryAt: null,
            },
          });
          continue;
        }

        const claim = await prisma.memeSubmission.updateMany({
          where: {
            id: c.id,
            status: { in: ['pending', 'approved'] },
            sourceKind: { in: ['upload', 'url'] },
            OR: [
              { aiStatus: 'pending' },
              { aiStatus: 'failed', OR: [{ aiNextRetryAt: null }, { aiNextRetryAt: { lte: now } }] },
              { aiStatus: 'processing', aiLastTriedAt: { lt: stuckBefore } },
            ],
          },
          data: {
            aiStatus: 'processing',
            aiLastTriedAt: now,
          },
        });

        if (claim.count !== 1) continue;
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
        } catch (e: any) {
          failed += 1;
          totalFailed += 1;
          const prevRetries = Number.isFinite(c.aiRetryCount as any) ? (c.aiRetryCount as number) : 0;
          const nextRetryCount = prevRetries + 1;
          const backoffMs = Math.min(60 * 60_000, 5_000 * Math.pow(2, Math.max(0, nextRetryCount - 1)));

          await prisma.memeSubmission.update({
            where: { id: c.id },
            data: {
              aiStatus: nextRetryCount >= maxRetries ? 'failed_final' : 'failed',
              aiRetryCount: nextRetryCount,
              aiLastTriedAt: now,
              aiNextRetryAt: nextRetryCount >= maxRetries ? null : new Date(Date.now() + backoffMs),
              aiError: String(e?.message || 'ai_failed'),
            },
          });
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
  } catch (e: any) {
    logger.error('ai_analysis.failed', {
      errorMessage: e?.message,
      errorStack: e?.stack,
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

