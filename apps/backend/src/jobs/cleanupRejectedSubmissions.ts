import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { releaseAdvisoryLock, tryAcquireAdvisoryLock } from '../utils/pgAdvisoryLock.js';

type CleanupOptions = {
  /** Delete rejected submissions older than this many days. */
  ttlDays: number;
  /** Max submissions per run. */
  batchSize: number;
};

function daysToMs(days: number): number {
  return Math.max(0, days) * 24 * 60 * 60 * 1000;
}

export async function cleanupRejectedSubmissions(opts: CleanupOptions): Promise<{
  scanned: number;
  deleted: number;
  fileRefsDecremented: number;
}> {
  const ttlDays = Number.isFinite(opts.ttlDays) ? opts.ttlDays : 30;
  const batchSize = Number.isFinite(opts.batchSize) ? opts.batchSize : 200;
  const cutoff = new Date(Date.now() - daysToMs(ttlDays));

  const rows = await prisma.memeSubmission.findMany({
    where: {
      status: 'rejected',
      createdAt: { lt: cutoff },
    },
    select: {
      id: true,
      fileHash: true,
      fileUrlTemp: true,
      createdAt: true,
    },
    take: Math.max(1, Math.min(batchSize, 1000)),
    orderBy: { createdAt: 'asc' },
  });

  let deleted = 0;
  let fileRefsDecremented = 0;

  for (const r of rows) {
    const p = String(r.fileUrlTemp || '');
    const shouldDecrement = Boolean(r.fileHash) || p.startsWith('/uploads/memes/');

    try {
      await prisma.memeSubmission.delete({ where: { id: r.id } });
      deleted += 1;
      if (shouldDecrement) fileRefsDecremented += 1;
    } catch (error) {
      const err = error as Error;
      logger.warn('cleanup.rejected.delete_failed', {
        submissionId: r.id,
        errorMessage: err.message,
      });
    }
  }

  return { scanned: rows.length, deleted, fileRefsDecremented };
}

export function startRejectedSubmissionsCleanupScheduler() {
  const ttlDays = parseInt(process.env.REJECTED_SUBMISSIONS_TTL_DAYS || '30', 10);
  const batchSize = parseInt(process.env.REJECTED_SUBMISSIONS_CLEANUP_BATCH || '200', 10);
  const intervalMs = parseInt(process.env.REJECTED_SUBMISSIONS_CLEANUP_INTERVAL_MS || String(24 * 60 * 60 * 1000), 10); // daily
  const initialDelayMs = parseInt(
    process.env.REJECTED_SUBMISSIONS_CLEANUP_INITIAL_DELAY_MS || String(5 * 60 * 1000),
    10
  ); // 5 min

  let running = false;
  // Ensure only one instance (prod or beta) runs cleanup on shared DB.
  const lockId = 421340n;

  const runOnce = async () => {
    if (running) return;
    running = true;
    const startedAt = Date.now();
    let locked = false;
    try {
      locked = await tryAcquireAdvisoryLock(lockId);
      if (!locked) return;
      const res = await cleanupRejectedSubmissions({
        ttlDays: Number.isFinite(ttlDays) ? ttlDays : 30,
        batchSize: Number.isFinite(batchSize) ? batchSize : 200,
      });
      logger.info('cleanup.rejected.completed', {
        ttlDays,
        batchSize,
        durationMs: Date.now() - startedAt,
        ...res,
      });
    } catch (error) {
      const err = error as Error;
      logger.error('cleanup.rejected.failed', {
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
