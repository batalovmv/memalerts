import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { releaseAdvisoryLock, tryAcquireAdvisoryLock } from '../utils/pgAdvisoryLock.js';

type RollupOptions = {
  /** How many days back to recompute (sliding window). */
  days: number;
};

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

export async function recomputeChannelDailyStats(opts: RollupOptions): Promise<{ days: number; rowsUpserted: number }> {
  const days = clampInt(opts.days, 1, 365, 45);
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Use raw SQL for performance: single aggregate scan over MemeActivation for the window.
  // This is safe because we only write to our own rollup table.
  const result = await prisma.$executeRawUnsafe(
    `
      INSERT INTO "ChannelDailyStats" (
        "channelId",
        "day",
        "totalActivationsCount",
        "totalCoinsSpentSum",
        "completedActivationsCount",
        "completedCoinsSpentSum",
        "uniqueUsersCountAll",
        "uniqueUsersCountCompleted",
        "updatedAt"
      )
      SELECT
        a."channelId",
        date_trunc('day', a."createdAt") as day,
        COUNT(*)::int as "totalActivationsCount",
        COALESCE(SUM(a."coinsSpent"), 0)::bigint as "totalCoinsSpentSum",
        COUNT(*) FILTER (WHERE a.status IN ('done','completed'))::int as "completedActivationsCount",
        COALESCE(SUM(a."coinsSpent") FILTER (WHERE a.status IN ('done','completed')), 0)::bigint as "completedCoinsSpentSum",
        COUNT(DISTINCT a."userId")::int as "uniqueUsersCountAll",
        COUNT(DISTINCT a."userId") FILTER (WHERE a.status IN ('done','completed'))::int as "uniqueUsersCountCompleted",
        CURRENT_TIMESTAMP as "updatedAt"
      FROM "MemeActivation" a
      WHERE a."createdAt" >= $1
      GROUP BY a."channelId", day
      ON CONFLICT ("channelId","day")
      DO UPDATE SET
        "totalActivationsCount" = EXCLUDED."totalActivationsCount",
        "totalCoinsSpentSum" = EXCLUDED."totalCoinsSpentSum",
        "completedActivationsCount" = EXCLUDED."completedActivationsCount",
        "completedCoinsSpentSum" = EXCLUDED."completedCoinsSpentSum",
        "uniqueUsersCountAll" = EXCLUDED."uniqueUsersCountAll",
        "uniqueUsersCountCompleted" = EXCLUDED."uniqueUsersCountCompleted",
        "updatedAt" = CURRENT_TIMESTAMP
    `,
    start
  );

  return { days, rowsUpserted: Number(result || 0) };
}

export function startChannelDailyStatsRollupScheduler() {
  const days = parseInt(String(process.env.CHANNEL_DAILY_STATS_ROLLUP_DAYS || ''), 10);
  const intervalMs = parseInt(String(process.env.CHANNEL_DAILY_STATS_ROLLUP_INTERVAL_MS || ''), 10);
  const initialDelayMs = parseInt(String(process.env.CHANNEL_DAILY_STATS_ROLLUP_INITIAL_DELAY_MS || ''), 10);

  const effectiveDays = Number.isFinite(days) && days > 0 ? days : 45;
  const effectiveInitialDelay = Number.isFinite(initialDelayMs) ? Math.max(0, initialDelayMs) : 60_000;
  const effectiveInterval = Number.isFinite(intervalMs) ? Math.max(60_000, intervalMs) : 5 * 60_000;

  let running = false;

  const runOnce = async () => {
    if (running) return;
    running = true;
    // Ensure only one instance (prod or beta) recomputes on shared DB.
    const lockId = 421337n;
    const startedAt = Date.now();
    try {
      const locked = await tryAcquireAdvisoryLock(lockId);
      if (!locked) return;
      const res = await recomputeChannelDailyStats({ days: effectiveDays });
      logger.info('rollup.channel_daily.completed', {
        days: res.days,
        rowsUpserted: res.rowsUpserted,
        durationMs: Date.now() - startedAt,
      });
    } catch (e: any) {
      logger.error('rollup.channel_daily.failed', {
        days: effectiveDays,
        durationMs: Date.now() - startedAt,
        errorMessage: e?.message,
      });
    } finally {
      await releaseAdvisoryLock(lockId);
      running = false;
    }
  };

  setTimeout(() => void runOnce(), effectiveInitialDelay);
  setInterval(() => void runOnce(), effectiveInterval);
}


