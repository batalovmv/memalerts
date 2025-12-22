import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { clampInt, getMemeStatsCacheMs, ifNoneMatchHit, makeEtagFromString, MEME_STATS_CACHE_MAX, memeStatsCache } from './cache.js';

export const getMemeStats = async (req: any, res: Response) => {
  const { period = 'month', limit = 10, channelId, channelSlug } = req.query;

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
    (req as any).__memeStatsCacheKey = key;
  } else {
    // Authenticated stats are user-dependent; allow only short private caching (or proxies may cache incorrectly).
    res.setHeader('Cache-Control', 'private, max-age=10, stale-while-revalidate=20');
  }

  // Build where clause
  const where: any = {
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

  const cacheKey = (req as any).__memeStatsCacheKey as string | undefined;
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


