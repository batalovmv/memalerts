import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { releaseAdvisoryLock, tryAcquireAdvisoryLock } from '../utils/pgAdvisoryLock.js';
import { sendTelegramAlert } from '../utils/telegramAlert.js';
import { statfs } from 'node:fs/promises';

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function isMonitorEnabled(): boolean {
  const raw = String(process.env.HEALTH_MONITOR_ENABLED || '').trim().toLowerCase();
  if (!raw) return true;
  return !['0', 'false', 'off', 'no'].includes(raw);
}

type HealthCheckResult = { ok: boolean; message?: string };
type HealthCheck = {
  name: string;
  check: () => Promise<HealthCheckResult>;
  alert: (message: string) => Promise<void>;
  autoFix?: () => Promise<void>;
};

function getMonitorConfig() {
  const stuckMsRaw =
    parseInt(String(process.env.HEALTH_AI_STUCK_MS || ''), 10) ||
    parseInt(String(process.env.AI_MODERATION_STUCK_MS || ''), 10);
  const diskMinBytesRaw = parseInt(String(process.env.HEALTH_DISK_MIN_BYTES || ''), 10);
  const errorWindowMsRaw = parseInt(String(process.env.HEALTH_AI_ERROR_WINDOW_MS || ''), 10);
  const errorMaxRaw = parseInt(String(process.env.HEALTH_AI_ERROR_MAX || ''), 10);
  const alertCooldownRaw = parseInt(String(process.env.HEALTH_ALERT_COOLDOWN_MS || ''), 10);

  return {
    aiStuckMs: clampInt(stuckMsRaw, 5 * 60 * 1000, 6 * 60 * 60 * 1000, 30 * 60 * 1000),
    diskPath:
      process.env.HEALTH_DISK_PATH ||
      (process.platform === 'win32' ? `${process.env.SYSTEMDRIVE || 'C:'}\\` : '/'),
    diskMinBytes: clampInt(diskMinBytesRaw, 512 * 1024 * 1024, 200 * 1024 * 1024 * 1024, 5 * 1024 * 1024 * 1024),
    errorWindowMs: clampInt(errorWindowMsRaw, 60 * 1000, 60 * 60 * 1000, 5 * 60 * 1000),
    errorMax: clampInt(errorMaxRaw, 1, 1000, 100),
    alertCooldownMs: clampInt(alertCooldownRaw, 60 * 1000, 60 * 60 * 1000, 10 * 60 * 1000),
  };
}

async function checkAiQueueStuck(stuckMs: number): Promise<HealthCheckResult> {
  const threshold = new Date(Date.now() - stuckMs);
  const count = await prisma.memeSubmission.count({
    where: {
      aiStatus: 'processing',
      aiProcessingStartedAt: { lt: threshold },
    },
  });
  if (count === 0) return { ok: true };
  return { ok: false, message: `${count} AI jobs stuck > ${Math.round(stuckMs / 60000)}m` };
}

async function autoFixAiQueueStuck(stuckMs: number): Promise<void> {
  const threshold = new Date(Date.now() - stuckMs);
  await prisma.memeSubmission.updateMany({
    where: {
      aiStatus: 'processing',
      aiProcessingStartedAt: { lt: threshold },
    },
    data: {
      aiStatus: 'pending',
      aiProcessingStartedAt: null,
      aiLockedBy: null,
      aiLockExpiresAt: null,
      aiNextRetryAt: new Date(),
      aiError: 'health_reset',
    },
  });
}

async function checkDiskSpace(path: string, minBytes: number): Promise<HealthCheckResult> {
  try {
    const stats = await statfs(path);
    const available = Number(stats.bavail) * Number(stats.bsize);
    if (available >= minBytes) return { ok: true };
    return {
      ok: false,
      message: `Low disk space: ${Math.round(available / (1024 * 1024))}MB available`,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error ?? 'unknown');
    return { ok: false, message: `Disk check failed: ${errMsg}` };
  }
}

async function checkAiErrorRate(windowMs: number, maxErrors: number): Promise<HealthCheckResult> {
  const since = new Date(Date.now() - windowMs);
  const count = await prisma.memeSubmission.count({
    where: {
      aiError: { not: null },
      aiLastTriedAt: { gte: since },
    },
  });
  if (count <= maxErrors) return { ok: true };
  return { ok: false, message: `AI error spike: ${count} errors in last ${Math.round(windowMs / 60000)}m` };
}

const lastAlertAt = new Map<string, number>();

async function alertOnce(name: string, message: string, cooldownMs: number): Promise<void> {
  const now = Date.now();
  const last = lastAlertAt.get(name) ?? 0;
  if (now - last < cooldownMs) return;
  lastAlertAt.set(name, now);
  await sendTelegramAlert(message);
}

export async function runHealthChecks(): Promise<void> {
  const config = getMonitorConfig();
  const checks: HealthCheck[] = [
    {
      name: 'ai_queue_stuck',
      check: () => checkAiQueueStuck(config.aiStuckMs),
      alert: async (message) => alertOnce('ai_queue_stuck', `⚠️ Health check failed: ${message}`, config.alertCooldownMs),
      autoFix: () => autoFixAiQueueStuck(config.aiStuckMs),
    },
    {
      name: 'disk_space',
      check: () => checkDiskSpace(config.diskPath, config.diskMinBytes),
      alert: async (message) => alertOnce('disk_space', `⚠️ Health check failed: ${message}`, config.alertCooldownMs),
    },
    {
      name: 'ai_error_rate',
      check: () => checkAiErrorRate(config.errorWindowMs, config.errorMax),
      alert: async (message) => alertOnce('ai_error_rate', `⚠️ Health check failed: ${message}`, config.alertCooldownMs),
    },
  ];

  for (const check of checks) {
    try {
      const result = await check.check();
      if (!result.ok) {
        await check.alert(result.message ? `${check.name}: ${result.message}` : check.name);
        if (check.autoFix) {
          await check.autoFix();
          logger.info('health.auto_fixed', { check: check.name });
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error ?? 'unknown');
      logger.error('health.check_error', { check: check.name, errorMessage: errMsg });
    }
  }
}

let schedulerTimer: NodeJS.Timeout | null = null;

export function startHealthMonitorScheduler(): void {
  if (!isMonitorEnabled()) {
    logger.info('health.monitor_disabled');
    return;
  }

  const intervalRaw = parseInt(String(process.env.HEALTH_MONITOR_INTERVAL_MS || ''), 10);
  const initialDelayRaw = parseInt(String(process.env.HEALTH_MONITOR_INITIAL_DELAY_MS || ''), 10);
  const intervalMs = clampInt(intervalRaw, 60_000, 30 * 60 * 1000, 5 * 60 * 1000);
  const initialDelayMs = clampInt(initialDelayRaw, 0, 10 * 60 * 1000, 60_000);
  const lockId = 903213n;

  const runOnce = async () => {
    const locked = await tryAcquireAdvisoryLock(lockId);
    if (!locked) return;
    try {
      await runHealthChecks();
    } finally {
      await releaseAdvisoryLock(lockId);
    }
  };

  setTimeout(() => void runOnce(), initialDelayMs);
  schedulerTimer = setInterval(() => void runOnce(), intervalMs);

  logger.info('health.monitor_started', { intervalMs, initialDelayMs });
}

export function stopHealthMonitorScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
