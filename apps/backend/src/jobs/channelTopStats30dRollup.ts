import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { releaseAdvisoryLock, tryAcquireAdvisoryLock } from '../utils/pgAdvisoryLock.js';

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

export async function recomputeTopStats30d(days: number): Promise<{ days: number }> {
  const effectiveDays = clampInt(days, 1, 90, 30);
  const windowEnd = new Date();
  const windowStart = new Date(Date.now() - effectiveDays * 24 * 60 * 60 * 1000);
  const runTs = new Date();

  // Upsert aggregates for the window, then delete rows not updated in this run.
  // This keeps results correct while preserving MVCC consistency for readers.
  const sql = `
      WITH base AS (
        SELECT "channelId", "userId", "memeId", "priceCoins", "status"
        FROM "MemeActivation"
        WHERE "createdAt" >= $1
      ),
      user_agg AS (
        SELECT
          b."channelId",
          b."userId",
          COUNT(*)::int AS total_count,
          COALESCE(SUM(b."priceCoins"), 0)::bigint AS total_coins,
          COUNT(*) FILTER (WHERE b.status IN ('done','completed'))::int AS completed_count,
          COALESCE(SUM(b."priceCoins") FILTER (WHERE b.status IN ('done','completed')), 0)::bigint AS completed_coins
        FROM base b
        GROUP BY b."channelId", b."userId"
      ),
      meme_agg AS (
        SELECT
          b."channelId",
          b."memeId",
          COUNT(*)::int AS total_count,
          COALESCE(SUM(b."priceCoins"), 0)::bigint AS total_coins,
          COUNT(*) FILTER (WHERE b.status IN ('done','completed'))::int AS completed_count,
          COALESCE(SUM(b."priceCoins") FILTER (WHERE b.status IN ('done','completed')), 0)::bigint AS completed_coins
        FROM base b
        GROUP BY b."channelId", b."memeId"
      ),
      global_meme_agg AS (
        SELECT
          b."memeId",
          COUNT(*) FILTER (WHERE b.status IN ('done','completed'))::int AS completed_count,
          COALESCE(SUM(b."priceCoins") FILTER (WHERE b.status IN ('done','completed')), 0)::bigint AS completed_coins
        FROM base b
        GROUP BY b."memeId"
      )
      INSERT INTO "ChannelUserStats30d" (
        "channelId","userId","windowStart","windowEnd",
        "totalActivationsCount","totalCoinsSpentSum",
        "completedActivationsCount","completedCoinsSpentSum",
        "updatedAt"
      )
      SELECT
        u."channelId",
        u."userId",
        $1::timestamp,
        $2::timestamp,
        u.total_count,
        u.total_coins,
        u.completed_count,
        u.completed_coins,
        $3::timestamp
      FROM user_agg u
      ON CONFLICT ("channelId","userId")
      DO UPDATE SET
        "windowStart" = EXCLUDED."windowStart",
        "windowEnd" = EXCLUDED."windowEnd",
        "totalActivationsCount" = EXCLUDED."totalActivationsCount",
        "totalCoinsSpentSum" = EXCLUDED."totalCoinsSpentSum",
        "completedActivationsCount" = EXCLUDED."completedActivationsCount",
        "completedCoinsSpentSum" = EXCLUDED."completedCoinsSpentSum",
        "updatedAt" = EXCLUDED."updatedAt"
    `;

  const sql2 = `
      WITH base AS (
        SELECT "channelId", "memeId", "priceCoins", "status", "createdAt"
        FROM "MemeActivation"
        WHERE "createdAt" >= $1
      ),
      meme_agg AS (
        SELECT
          b."channelId",
          b."memeId",
          COUNT(*)::int AS total_count,
          COALESCE(SUM(b."priceCoins"), 0)::bigint AS total_coins,
          COUNT(*) FILTER (WHERE b.status IN ('done','completed'))::int AS completed_count,
          COALESCE(SUM(b."priceCoins") FILTER (WHERE b.status IN ('done','completed')), 0)::bigint AS completed_coins
        FROM base b
        GROUP BY b."channelId", b."memeId"
      )
      INSERT INTO "ChannelMemeStats30d" (
        "channelId","memeId","windowStart","windowEnd",
        "totalActivationsCount","totalCoinsSpentSum",
        "completedActivationsCount","completedCoinsSpentSum",
        "updatedAt"
      )
      SELECT
        m."channelId",
        m."memeId",
        $1::timestamp,
        $2::timestamp,
        m.total_count,
        m.total_coins,
        m.completed_count,
        m.completed_coins,
        $3::timestamp
      FROM meme_agg m
      ON CONFLICT ("channelId","memeId")
      DO UPDATE SET
        "windowStart" = EXCLUDED."windowStart",
        "windowEnd" = EXCLUDED."windowEnd",
        "totalActivationsCount" = EXCLUDED."totalActivationsCount",
        "totalCoinsSpentSum" = EXCLUDED."totalCoinsSpentSum",
        "completedActivationsCount" = EXCLUDED."completedActivationsCount",
        "completedCoinsSpentSum" = EXCLUDED."completedCoinsSpentSum",
        "updatedAt" = EXCLUDED."updatedAt"
    `;

  const sql3 = `
      WITH base AS (
        SELECT "memeId", "priceCoins", "status", "createdAt"
        FROM "MemeActivation"
        WHERE "createdAt" >= $1
      ),
      global_meme_agg AS (
        SELECT
          b."memeId",
          COUNT(*) FILTER (WHERE b.status IN ('done','completed'))::int AS completed_count,
          COALESCE(SUM(b."priceCoins") FILTER (WHERE b.status IN ('done','completed')), 0)::bigint AS completed_coins
        FROM base b
        GROUP BY b."memeId"
      )
      INSERT INTO "GlobalMemeStats30d" (
        "memeId","windowStart","windowEnd",
        "completedActivationsCount","completedCoinsSpentSum",
        "updatedAt"
      )
      SELECT
        g."memeId",
        $1::timestamp,
        $2::timestamp,
        g.completed_count,
        g.completed_coins,
        $3::timestamp
      FROM global_meme_agg g
      ON CONFLICT ("memeId")
      DO UPDATE SET
        "windowStart" = EXCLUDED."windowStart",
        "windowEnd" = EXCLUDED."windowEnd",
        "completedActivationsCount" = EXCLUDED."completedActivationsCount",
        "completedCoinsSpentSum" = EXCLUDED."completedCoinsSpentSum",
        "updatedAt" = EXCLUDED."updatedAt"
    `;

  // Prisma does not allow multiple SQL statements in one prepared statement call.
  // Keep them separate to avoid `ERROR: cannot insert multiple commands into a prepared statement`.
  await prisma.$transaction([
    prisma.$executeRawUnsafe(sql, windowStart, windowEnd, runTs),
    prisma.$executeRawUnsafe(sql2, windowStart, windowEnd, runTs),
    prisma.$executeRawUnsafe(sql3, windowStart, windowEnd, runTs),
    prisma.$executeRawUnsafe(`DELETE FROM "ChannelUserStats30d" WHERE "updatedAt" < $1::timestamp`, runTs),
    prisma.$executeRawUnsafe(`DELETE FROM "ChannelMemeStats30d" WHERE "updatedAt" < $1::timestamp`, runTs),
    prisma.$executeRawUnsafe(`DELETE FROM "GlobalMemeStats30d" WHERE "updatedAt" < $1::timestamp`, runTs),
  ]);

  return { days: effectiveDays };
}

export function startTopStats30dRollupScheduler() {
  const daysRaw = parseInt(String(process.env.TOP_STATS_30D_ROLLUP_DAYS || ''), 10);
  const intervalRaw = parseInt(String(process.env.TOP_STATS_30D_ROLLUP_INTERVAL_MS || ''), 10);
  const initialDelayRaw = parseInt(String(process.env.TOP_STATS_30D_ROLLUP_INITIAL_DELAY_MS || ''), 10);

  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? daysRaw : 30;
  const initialDelay = Number.isFinite(initialDelayRaw) ? Math.max(0, initialDelayRaw) : 90_000;
  const intervalMs = Number.isFinite(intervalRaw) ? Math.max(60_000, intervalRaw) : 5 * 60_000;

  let running = false;
  const lockId = 421338n;

  const runOnce = async () => {
    if (running) return;
    running = true;
    const startedAt = Date.now();
    try {
      const locked = await tryAcquireAdvisoryLock(lockId);
      if (!locked) return;
      const res = await recomputeTopStats30d(days);
      logger.info('rollup.top_stats_30d.completed', {
        days: res.days,
        durationMs: Date.now() - startedAt,
      });
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      logger.error('rollup.top_stats_30d.failed', {
        days,
        durationMs: Date.now() - startedAt,
        errorMessage,
      });
    } finally {
      await releaseAdvisoryLock(lockId);
      running = false;
    }
  };

  setTimeout(() => void runOnce(), initialDelay);
  setInterval(() => void runOnce(), intervalMs);
}
