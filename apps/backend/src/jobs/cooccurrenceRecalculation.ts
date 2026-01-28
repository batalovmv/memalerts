import { CooccurrenceService } from '../services/recommendations/CooccurrenceService.js';
import { logger } from '../utils/logger.js';
import { releaseAdvisoryLock, tryAcquireAdvisoryLock } from '../utils/pgAdvisoryLock.js';

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function isSchedulerEnabled(): boolean {
  const raw = String(process.env.COOCCURRENCE_RECALC_ENABLED || '').trim().toLowerCase();
  if (!raw) return true;
  return !['0', 'false', 'off', 'no'].includes(raw);
}

let schedulerTimer: NodeJS.Timeout | null = null;

export function startCooccurrenceRecalculationScheduler(): void {
  if (!isSchedulerEnabled()) {
    logger.info('cooccurrence.scheduler_disabled');
    return;
  }

  const intervalRaw = parseInt(String(process.env.COOCCURRENCE_RECALC_INTERVAL_MS || ''), 10);
  const initialDelayRaw = parseInt(String(process.env.COOCCURRENCE_RECALC_INITIAL_DELAY_MS || ''), 10);
  const intervalMs = clampInt(intervalRaw, 5 * 60 * 1000, 24 * 60 * 60 * 1000, 60 * 60 * 1000);
  const initialDelayMs = clampInt(initialDelayRaw, 0, 6 * 60 * 60 * 1000, 60 * 1000);

  const lockId = 774913n;
  let running = false;

  const runOnce = async () => {
    if (running) return;
    running = true;
    const startedAt = Date.now();
    try {
      const locked = await tryAcquireAdvisoryLock(lockId);
      if (!locked) return;
      await CooccurrenceService.recalculateAll();
      logger.info('cooccurrence.scheduler.completed', { durationMs: Date.now() - startedAt });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error ?? 'unknown');
      logger.error('cooccurrence.scheduler.failed', { errorMessage: errMsg, durationMs: Date.now() - startedAt });
    } finally {
      await releaseAdvisoryLock(lockId);
      running = false;
    }
  };

  setTimeout(() => void runOnce(), initialDelayMs);
  schedulerTimer = setInterval(() => void runOnce(), intervalMs);

  logger.info('cooccurrence.scheduler_started', { intervalMs, initialDelayMs });
}

export function stopCooccurrenceRecalculationScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
