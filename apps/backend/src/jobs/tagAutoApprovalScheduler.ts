import { logger } from '../utils/logger.js';
import { releaseAdvisoryLock, tryAcquireAdvisoryLock } from '../utils/pgAdvisoryLock.js';
import { deprecateUnusedTags, processPendingTagSuggestions, resetTagAiValidationLimit } from './tagAutoApproval.js';

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

let schedulerTimer: NodeJS.Timeout | null = null;
let deprecateTimer: NodeJS.Timeout | null = null;
let resetTimer: NodeJS.Timeout | null = null;

export function startTagAutoApprovalScheduler(): void {
  const intervalMsRaw = parseInt(String(process.env.TAG_AUTO_APPROVAL_INTERVAL_MS || ''), 10);
  const intervalMs = clampInt(
    Number.isFinite(intervalMsRaw) ? intervalMsRaw : 10 * 60 * 1000,
    60_000,
    60 * 60 * 1000,
    10 * 60 * 1000
  );
  const batchSizeRaw = parseInt(String(process.env.TAG_AUTO_APPROVAL_BATCH_SIZE || ''), 10);
  const batchSize = clampInt(Number.isFinite(batchSizeRaw) ? batchSizeRaw : 25, 1, 200, 25);
  const initialDelayRaw = parseInt(String(process.env.TAG_AUTO_APPROVAL_INITIAL_DELAY_MS || ''), 10);
  const initialDelayMs = clampInt(
    Number.isFinite(initialDelayRaw) ? initialDelayRaw : 30_000,
    0,
    10 * 60 * 1000,
    30_000
  );

  const resetIntervalRaw = parseInt(String(process.env.TAG_AUTO_APPROVAL_RESET_INTERVAL_MS || ''), 10);
  const resetIntervalMs = clampInt(
    Number.isFinite(resetIntervalRaw) ? resetIntervalRaw : 60 * 60 * 1000,
    60_000,
    6 * 60 * 60 * 1000,
    60 * 60 * 1000
  );
  const deprecateIntervalRaw = parseInt(String(process.env.TAG_AUTO_APPROVAL_DEPRECATE_INTERVAL_MS || ''), 10);
  const deprecateIntervalMs = clampInt(
    Number.isFinite(deprecateIntervalRaw) ? deprecateIntervalRaw : 24 * 60 * 60 * 1000,
    60_000,
    7 * 24 * 60 * 60 * 1000,
    24 * 60 * 60 * 1000
  );

  let running = false;
  const lockId = 889211n;

  const runOnce = async () => {
    if (running) return;
    running = true;
    let locked = false;
    const startedAt = Date.now();
    try {
      locked = await tryAcquireAdvisoryLock(lockId);
      if (!locked) return;
      const res = await processPendingTagSuggestions({ limit: batchSize });
      if (res.scanned > 0) {
        logger.info('tag.auto_approval.completed', {
          scanned: res.scanned,
          processed: res.processed,
          actions: res.actions,
          durationMs: Date.now() - startedAt,
        });
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error ?? 'unknown');
      logger.error('tag.auto_approval.failed', { errorMessage: errMsg, durationMs: Date.now() - startedAt });
    } finally {
      if (locked) await releaseAdvisoryLock(lockId);
      running = false;
    }
  };

  const runDeprecation = async () => {
    const lock = 889212n;
    let locked = false;
    const startedAt = Date.now();
    try {
      locked = await tryAcquireAdvisoryLock(lock);
      if (!locked) return;
      const res = await deprecateUnusedTags();
      if (res.deprecated > 0) {
        logger.info('tag.auto_approval.deprecated', { deprecated: res.deprecated, durationMs: Date.now() - startedAt });
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error ?? 'unknown');
      logger.error('tag.auto_approval.deprecate_failed', { errorMessage: errMsg, durationMs: Date.now() - startedAt });
    } finally {
      if (locked) await releaseAdvisoryLock(lock);
    }
  };

  // Run once at startup
  setTimeout(() => void runOnce(), initialDelayMs);
  schedulerTimer = setInterval(() => void runOnce(), intervalMs);

  resetTimer = setInterval(() => {
    resetTagAiValidationLimit();
    logger.info('tag.auto_approval.rate_limit_reset');
  }, resetIntervalMs);

  deprecateTimer = setInterval(() => void runDeprecation(), deprecateIntervalMs);

  logger.info('tag.auto_approval.scheduler_started', {
    intervalMs,
    batchSize,
    resetIntervalMs,
    deprecateIntervalMs,
  });
}

export function stopTagAutoApprovalScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  if (deprecateTimer) {
    clearInterval(deprecateTimer);
    deprecateTimer = null;
  }
  if (resetTimer) {
    clearInterval(resetTimer);
    resetTimer = null;
  }
}
