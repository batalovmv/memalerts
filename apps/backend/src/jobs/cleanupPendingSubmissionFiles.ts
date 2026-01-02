import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { releaseAdvisoryLock, tryAcquireAdvisoryLock } from '../utils/pgAdvisoryLock.js';
import { decrementFileHashReference } from '../utils/fileHash.js';

type CleanupOptions = {
  retentionHours: number;
  maxRetries: number;
  batchSize: number;
};

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function hoursToMs(h: number): number {
  return Math.max(0, h) * 60 * 60 * 1000;
}

export async function cleanupPendingSubmissionFilesOnce(opts: CleanupOptions): Promise<{
  scanned: number;
  cleaned: number;
  fileRefsDecremented: number;
}> {
  const retentionHours = Number.isFinite(opts.retentionHours) ? opts.retentionHours : 72;
  const maxRetries = Number.isFinite(opts.maxRetries) ? opts.maxRetries : 5;
  const batchSize = clampInt(opts.batchSize, 1, 1000, 200);
  const cutoff = new Date(Date.now() - hoursToMs(retentionHours));

  const rows = await prisma.memeSubmission.findMany({
    where: {
      status: 'pending',
      sourceKind: 'upload',
      createdAt: { lt: cutoff },
      aiStatus: 'failed',
      aiRetryCount: { gte: maxRetries },
    },
    select: {
      id: true,
      channelId: true,
      fileHash: true,
      fileUrlTemp: true,
      aiRetryCount: true,
      createdAt: true,
    },
    take: batchSize,
    orderBy: { createdAt: 'asc' },
  });

  let cleaned = 0;
  let fileRefsDecremented = 0;

  for (const r of rows) {
    try {
      // Best-effort: if we have a stable fileHash, decrement reference count (storage cleanup is handled there).
      const hash = r.fileHash ? String(r.fileHash) : '';
      if (hash) {
        await decrementFileHashReference(hash);
        fileRefsDecremented += 1;
      }
    } catch (e: any) {
      logger.warn('cleanup.pending_files.decrement_failed', { submissionId: r.id, errorMessage: e?.message });
    }

    try {
      await prisma.memeSubmission.update({
        where: { id: r.id },
        data: {
          aiStatus: 'failed_final',
          aiError: 'retention_expired',
          aiNextRetryAt: null,
        },
      });
      cleaned += 1;
    } catch (e: any) {
      logger.warn('cleanup.pending_files.update_failed', { submissionId: r.id, errorMessage: e?.message });
    }
  }

  return { scanned: rows.length, cleaned, fileRefsDecremented };
}

export function startPendingSubmissionFilesCleanupScheduler() {
  const retentionHours = clampInt(parseInt(String(process.env.AI_PENDING_FILE_RETENTION_HOURS || '72'), 10), 1, 24 * 30, 72);
  const maxRetries = clampInt(parseInt(String(process.env.AI_MAX_RETRIES || '5'), 10), 0, 50, 5);
  const batchSize = clampInt(parseInt(String(process.env.AI_PENDING_FILE_CLEANUP_BATCH || '200'), 10), 1, 1000, 200);
  const intervalMs = clampInt(parseInt(String(process.env.AI_PENDING_FILE_CLEANUP_INTERVAL_MS || ''), 10), 60_000, 24 * 60 * 60_000, 6 * 60 * 60_000); // 6h
  const initialDelayMs = clampInt(parseInt(String(process.env.AI_PENDING_FILE_CLEANUP_INITIAL_DELAY_MS || ''), 10), 0, 24 * 60 * 60_000, 10 * 60_000);

  let running = false;
  // Ensure only one instance (prod or beta) runs cleanup on shared DB.
  const lockId = 421398n;

  const runOnce = async () => {
    if (running) return;
    running = true;
    const startedAt = Date.now();
    let locked = false;
    try {
      locked = await tryAcquireAdvisoryLock(lockId);
      if (!locked) return;

      const res = await cleanupPendingSubmissionFilesOnce({ retentionHours, maxRetries, batchSize });
      logger.info('cleanup.pending_files.completed', {
        retentionHours,
        maxRetries,
        batchSize,
        durationMs: Date.now() - startedAt,
        ...res,
      });
    } catch (e: any) {
      logger.error('cleanup.pending_files.failed', { errorMessage: e?.message, durationMs: Date.now() - startedAt });
    } finally {
      if (locked) await releaseAdvisoryLock(lockId);
      running = false;
    }
  };

  setTimeout(() => void runOnce(), initialDelayMs);
  setInterval(() => void runOnce(), intervalMs);
}


