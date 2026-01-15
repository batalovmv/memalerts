import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import {
  clampInt,
  getMemeStatsCacheMs,
  ifNoneMatchHit,
  makeEtagFromString,
  MEME_STATS_CACHE_MAX,
  memeStatsCache,
} from './cache.js';
import type { AuthRequest } from '../../middleware/auth.js';

type MemeStatsRequest = AuthRequest & { __memeStatsCacheKey?: string };

export const getMemeStats = async (req: MemeStatsRequest, res: Response) => {
  const query = (req.query ?? {}) as Record<string, unknown>;
  const { period = 'month', limit = 10, channelId, channelSlug } = query;

  // Clamp limit (defensive).
  const maxFromEnv = parseInt(String(process.env.MEME_STATS_MAX || ''), 10);
  const MAX_STATS = Number.isFinite(maxFromEnv) && maxFromEnv > 0 ? maxFromEnv : 50;
  const parsedLimit = clampInt(parseInt(limit as string, 10), 1, MAX_STATS, 10);

  // Normalize/validate period (back-compat: unknown -> 'month').
  const periodRaw = String(period || 'month').toLowerCase();
  const allowedPeriods = new Set(['day', 'week', 'month', 'year', 'all']);
  const effectivePeriod = allowedPeriods.has(periodRaw) ? periodRaw : 'month';

  // Determine channel
  let targetChannelId: string | null = null;
  if (channelSlug) {
    const channel = await prisma.channel.findUnique({
      where: { slug: channelSlug as string },
      select: { id: true },
    });
    if (channel) {
      targetChannelId = channel.id;
    }
  } else if (channelId) {
    targetChannelId = channelId as string;
  }

  // Calculate date range
  // Round "now" to the minute for better cache hit-rate (stats don't need sub-minute precision).
  const now = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  let startDate: Date;
  switch (effectivePeriod) {
    case 'day':
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case 'week':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'month':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case 'year':
      startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(0); // All time
  }

  // Cache only for unauthenticated requests (auth excludes "self" and is user-dependent).
  const canCache = !req.userId;
  if (canCache) {
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    const key = ['v1', targetChannelId ?? '', effectivePeriod, String(parsedLimit), now.toISOString()].join('|');
    const cached = memeStatsCache.get(key);
    const ttl = getMemeStatsCacheMs();
    if (cached && Date.now() - cached.ts < ttl) {
      res.setHeader('ETag', cached.etag);
      if (ifNoneMatchHit(req, cached.etag)) return res.status(304).end();
      return res.type('application/json').send(cached.body);
    }
    req.__memeStatsCacheKey = key;
  } else {
    // Authenticated stats are user-dependent; allow only short private caching (or proxies may cache incorrectly).
    res.setHeader('Cache-Control', 'private, max-age=10, stale-while-revalidate=20');
  }

  // Fast path (min-load strategy): unauth + period in (day/week/month) -> use rollups.
  // - day/week: sum daily rollups over 1/7 days
  // - month: use 30d rollup tables (cheapest)
  // For other periods (year/all) or when authenticated (excludes "self"), keep the live query.
  if (canCache && (effectivePeriod === 'day' || effectivePeriod === 'week')) {
    const windowDays = effectivePeriod === 'day' ? 1 : 7;
    const start = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
    try {
      // Use raw SQL to aggregate over the daily table efficiently (top-N by summed count).
      const rows = targetChannelId
        ? await prisma.$queryRaw<Array<{ memeId: string; cnt: bigint; coins: bigint }>>`
            SELECT "memeId",
                   SUM("completedActivationsCount")::bigint AS cnt,
                   SUM("completedCoinsSpentSum")::bigint AS coins
            FROM "ChannelMemeDailyStats"
            WHERE "channelId" = ${targetChannelId}
              AND "day" >= ${start}
            GROUP BY "memeId"
            ORDER BY cnt DESC, coins DESC
            LIMIT ${parsedLimit}
          `
        : await prisma.$queryRaw<Array<{ memeId: string; cnt: bigint; coins: bigint }>>`
            SELECT "memeId",
                   SUM("completedActivationsCount")::bigint AS cnt,
                   SUM("completedCoinsSpentSum")::bigint AS coins
            FROM "GlobalMemeDailyStats"
            WHERE "day" >= ${start}
            GROUP BY "memeId"
            ORDER BY cnt DESC, coins DESC
            LIMIT ${parsedLimit}
          `;

      const memeIds = rows.map((r) => r.memeId);
      const memes = memeIds.length
        ? await prisma.meme.findMany({
            where: { id: { in: memeIds } },
            include: {
              createdBy: { select: { id: true, displayName: true } },
              tags: { include: { tag: true } },
            },
          })
        : [];
      const map = new Map(memes.map((m) => [m.id, m]));
      const stats = rows.map((r) => {
        const meme = map.get(r.memeId);
        return {
          meme: meme
            ? {
                id: meme.id,
                title: meme.title,
                priceCoins: meme.priceCoins,
                tags: meme.tags,
              }
            : null,
          activationsCount: Number(r.cnt || 0n),
          totalCoinsSpent: Number(r.coins || 0n),
        };
      });

      const payload = {
        period: effectivePeriod,
        startDate: startDate,
        endDate: now,
        stats,
        rollup: {
          windowDays,
          source: targetChannelId ? 'ChannelMemeDailyStats' : 'GlobalMemeDailyStats',
        },
      };

      const cacheKey = req.__memeStatsCacheKey;
      if (cacheKey) {
        try {
          const body = JSON.stringify(payload);
          const etag = makeEtagFromString(body);
          memeStatsCache.set(cacheKey, { ts: Date.now(), body, etag });
          if (memeStatsCache.size > MEME_STATS_CACHE_MAX) memeStatsCache.clear();
          res.setHeader('ETag', etag);
          if (ifNoneMatchHit(req, etag)) return res.status(304).end();
          return res.type('application/json').send(body);
        } catch {
          // fall through
        }
      }
      return res.json(payload);
    } catch (error) {
      const prismaError = error as { code?: string };
      // Back-compat: daily tables might not exist yet.
      if (prismaError.code !== 'P2021') throw error;
      // fall through to live query
    }
  }

  if (canCache && effectivePeriod === 'month') {
    try {
      const rows = targetChannelId
        ? await prisma.channelMemeStats30d.findMany({
            where: { channelId: targetChannelId },
            orderBy: [{ completedActivationsCount: 'desc' }, { completedCoinsSpentSum: 'desc' }],
            take: parsedLimit,
            select: { memeId: true, completedActivationsCount: true, completedCoinsSpentSum: true },
          })
        : await prisma.globalMemeStats30d.findMany({
            orderBy: [{ completedActivationsCount: 'desc' }, { completedCoinsSpentSum: 'desc' }],
            take: parsedLimit,
            select: { memeId: true, completedActivationsCount: true, completedCoinsSpentSum: true },
          });

      const memeIds = rows.map((r) => r.memeId);
      const memes = memeIds.length
        ? await prisma.meme.findMany({
            where: { id: { in: memeIds } },
            include: {
              createdBy: { select: { id: true, displayName: true } },
              tags: { include: { tag: true } },
            },
          })
        : [];

      const map = new Map(memes.map((m) => [m.id, m]));
      const stats = rows.map((r) => {
        const meme = map.get(r.memeId);
        return {
          meme: meme
            ? {
                id: meme.id,
                title: meme.title,
                priceCoins: meme.priceCoins,
                tags: meme.tags,
              }
            : null,
          activationsCount: Number(r.completedActivationsCount || 0),
          totalCoinsSpent: Number(r.completedCoinsSpentSum || 0),
        };
      });

      const payload = {
        period: effectivePeriod,
        startDate,
        endDate: now,
        stats,
        rollup: {
          windowDays: 30,
          source: targetChannelId ? 'channelMemeStats30d' : 'globalMemeStats30d',
        },
      };

      const cacheKey = req.__memeStatsCacheKey;
      if (cacheKey) {
        try {
          const body = JSON.stringify(payload);
          const etag = makeEtagFromString(body);
          memeStatsCache.set(cacheKey, { ts: Date.now(), body, etag });
          if (memeStatsCache.size > MEME_STATS_CACHE_MAX) memeStatsCache.clear();
          res.setHeader('ETag', etag);
          if (ifNoneMatchHit(req, etag)) return res.status(304).end();
          return res.type('application/json').send(body);
        } catch {
          // fall through
        }
      }
      return res.json(payload);
    } catch (error) {
      const prismaError = error as { code?: string };
      // Back-compat: rollup tables might not exist yet.
      if (prismaError.code !== 'P2021') throw error;
      // fall through to live query
    }
  }

  // Build where clause
  const where: Prisma.MemeActivationWhereInput = {
    status: { in: ['done', 'completed'] }, // Only count completed activations
    createdAt: {
      gte: startDate,
    },
  };

  if (targetChannelId) {
    where.channelId = targetChannelId;
  }

  // Stats are meant to reflect viewer behavior; exclude "self" when authenticated (e.g. streamer viewing own stats).
  if (req.userId) {
    where.userId = { not: req.userId };
  }

  // Get meme statistics
  const activations = await prisma.memeActivation.groupBy({
    by: ['memeId'],
    where,
    _count: {
      id: true,
    },
    _sum: {
      coinsSpent: true,
    },
    orderBy: {
      _count: {
        id: 'desc',
      },
    },
    take: parsedLimit,
  });

  // Get meme details
  const memeIds = activations.map((a) => a.memeId);
  const memes = await prisma.meme.findMany({
    where: {
      id: {
        in: memeIds,
      },
    },
    include: {
      createdBy: {
        select: {
          id: true,
          displayName: true,
        },
      },
      tags: {
        include: {
          tag: true,
        },
      },
    },
  });

  // Combine data
  const stats = activations.map((activation) => {
    const meme = memes.find((m) => m.id === activation.memeId);
    return {
      meme: meme
        ? {
            id: meme.id,
            title: meme.title,
            priceCoins: meme.priceCoins,
            tags: meme.tags,
          }
        : null,
      activationsCount: activation._count.id,
      totalCoinsSpent: activation._sum.coinsSpent || 0,
    };
  });

  const payload = {
    period: effectivePeriod,
    startDate,
    endDate: now,
    stats,
  };

  const cacheKey = req.__memeStatsCacheKey;
  if (cacheKey) {
    try {
      const body = JSON.stringify(payload);
      const etag = makeEtagFromString(body);
      memeStatsCache.set(cacheKey, { ts: Date.now(), body, etag });
      if (memeStatsCache.size > MEME_STATS_CACHE_MAX) memeStatsCache.clear();
      res.setHeader('ETag', etag);
      if (ifNoneMatchHit(req, etag)) return res.status(304).end();
      return res.type('application/json').send(body);
    } catch {
      // fall through
    }
  }

  return res.json(payload);
};
