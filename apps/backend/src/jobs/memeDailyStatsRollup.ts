import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { releaseAdvisoryLock, tryAcquireAdvisoryLock } from '../utils/pgAdvisoryLock.js';

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

export async function recomputeMemeDailyStats(days: number): Promise<{ days: number }> {
  const effectiveDays = clampInt(days, 1, 365, 45);
  const start = new Date(Date.now() - effectiveDays * 24 * 60 * 60 * 1000);
  const runTs = new Date();

  // Completed-only stats (viewer semantics).
  // Upsert per (day,memeId) globally and per (channelId,day,memeId) for channel-scoped stats.
  const sql1 = `
      WITH base AS (
        SELECT "channelId","memeId","coinsSpent","createdAt"
        FROM "MemeActivation"
        WHERE "createdAt" >= $1
          AND status IN ('done','completed')
      ),
      channel_daily AS (
        SELECT
          b."channelId",
          date_trunc('day', b."createdAt") as day,
          b."memeId",
          COUNT(*)::int as cnt,
          COALESCE(SUM(b."coinsSpent"), 0)::bigint as coins
        FROM base b
        GROUP BY b."channelId", day, b."memeId"
      )
      INSERT INTO "ChannelMemeDailyStats" (
        "channelId","day","memeId",
        "completedActivationsCount","completedCoinsSpentSum","updatedAt"
      )
      SELECT
        c."channelId",
        c.day,
        c."memeId",
        c.cnt,
        c.coins,
        $2::timestamp
      FROM channel_daily c
      ON CONFLICT ("channelId","day","memeId")
      DO UPDATE SET
        "completedActivationsCount" = EXCLUDED."completedActivationsCount",
        "completedCoinsSpentSum" = EXCLUDED."completedCoinsSpentSum",
        "updatedAt" = EXCLUDED."updatedAt"
    `;

  const sql2 = `
      WITH base AS (
        SELECT "memeId","coinsSpent","createdAt"
        FROM "MemeActivation"
        WHERE "createdAt" >= $1
          AND status IN ('done','completed')
      ),
      global_daily AS (
        SELECT
          date_trunc('day', b."createdAt") as day,
          b."memeId",
          COUNT(*)::int as cnt,
          COALESCE(SUM(b."coinsSpent"), 0)::bigint as coins
        FROM base b
        GROUP BY day, b."memeId"
      )
      INSERT INTO "GlobalMemeDailyStats" (
        "day","memeId",
        "completedActivationsCount","completedCoinsSpentSum","updatedAt"
      )
      SELECT
        g.day,
        g."memeId",
        g.cnt,
        g.coins,
        $2::timestamp
      FROM global_daily g
      ON CONFLICT ("day","memeId")
      DO UPDATE SET
        "completedActivationsCount" = EXCLUDED."completedActivationsCount",
        "completedCoinsSpentSum" = EXCLUDED."completedCoinsSpentSum",
        "updatedAt" = EXCLUDED."updatedAt"
    `;

  // Prisma does not allow multiple SQL statements in one prepared statement call.
  await prisma.$transaction([
    prisma.$executeRawUnsafe(sql1, start, runTs),
    prisma.$executeRawUnsafe(sql2, start, runTs),
    prisma.$executeRawUnsafe(
      `DELETE FROM "ChannelMemeDailyStats" WHERE "day" < date_trunc('day', $1::timestamp)`,
      start
    ),
    prisma.$executeRawUnsafe(
      `DELETE FROM "GlobalMemeDailyStats" WHERE "day" < date_trunc('day', $1::timestamp)`,
      start
    ),
  ]);

  return { days: effectiveDays };
}

export function startMemeDailyStatsRollupScheduler() {
  const daysRaw = parseInt(String(process.env.MEME_DAILY_STATS_ROLLUP_DAYS || ''), 10);
  const intervalRaw = parseInt(String(process.env.MEME_DAILY_STATS_ROLLUP_INTERVAL_MS || ''), 10);
  const initialDelayRaw = parseInt(String(process.env.MEME_DAILY_STATS_ROLLUP_INITIAL_DELAY_MS || ''), 10);

  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? daysRaw : 45;
  const initialDelay = Number.isFinite(initialDelayRaw) ? Math.max(0, initialDelayRaw) : 75_000;
  const intervalMs = Number.isFinite(intervalRaw) ? Math.max(60_000, intervalRaw) : 5 * 60_000;

  let running = false;
  const lockId = 421339n;

  const runOnce = async () => {
    if (running) return;
    running = true;
    const startedAt = Date.now();
    try {
      const locked = await tryAcquireAdvisoryLock(lockId);
      if (!locked) return;
      const res = await recomputeMemeDailyStats(days);
      logger.info('rollup.meme_daily.completed', { days: res.days, durationMs: Date.now() - startedAt });
    } catch (error) {
      const err = error as Error;
      logger.error('rollup.meme_daily.failed', { days, durationMs: Date.now() - startedAt, errorMessage: err.message });
    } finally {
      await releaseAdvisoryLock(lockId);
      running = false;
    }
  };

  setTimeout(() => void runOnce(), initialDelay);
  setInterval(() => void runOnce(), intervalMs);
}
