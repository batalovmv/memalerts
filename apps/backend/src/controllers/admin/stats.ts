import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import crypto from 'crypto';

type ChannelStatsCacheEntry = { ts: number; etag: string; body: string };
const channelStatsCache = new Map<string, ChannelStatsCacheEntry>();
const CHANNEL_STATS_CACHE_MS_DEFAULT = 30_000;
const CHANNEL_STATS_CACHE_MAX = 200;

function getChannelStatsCacheMs(): number {
  const raw = parseInt(String(process.env.ADMIN_STATS_CACHE_MS || ''), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : CHANNEL_STATS_CACHE_MS_DEFAULT;
}

function makeEtagFromString(body: string): string {
  const hash = crypto.createHash('sha1').update(body).digest('base64');
  return `"${hash}"`;
}

function ifNoneMatchHit(req: any, etag: string): boolean {
  const inm = req?.headers?.['if-none-match'];
  if (!inm) return false;
  const raw = Array.isArray(inm) ? inm.join(',') : String(inm);
  return raw.split(',').map((s) => s.trim()).includes(etag);
}

// Channel statistics
export const getChannelStats = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  try {
    // This is role-protected in routes, but we still treat it as potentially hot:
    // - cache briefly to reduce repeat compute when the UI is reopened/refreshed
    // - ETag/304 to avoid sending identical payloads repeatedly
    res.setHeader('Cache-Control', 'private, max-age=20, stale-while-revalidate=40');
    const cacheTtl = getChannelStatsCacheMs();
    const cacheKey = `v1:${channelId}:${Math.floor(Date.now() / 60_000)}`; // minute bucket
    const cached = channelStatsCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < cacheTtl) {
      res.setHeader('ETag', cached.etag);
      if (ifNoneMatchHit(req, cached.etag)) return res.status(304).end();
      return res.type('application/json').send(cached.body);
    }

    // Get user spending stats
    const [userSpending, memeStats, totalActivations, totalCoinsSpent, totalMemes, daily] = await Promise.all([
      prisma.memeActivation.groupBy({
        by: ['userId'],
        where: { channelId },
        _sum: { coinsSpent: true },
        _count: { id: true },
        orderBy: { _sum: { coinsSpent: 'desc' } },
        take: 20,
      }),
      prisma.memeActivation.groupBy({
        by: ['memeId'],
        where: { channelId },
        _count: { id: true },
        _sum: { coinsSpent: true },
        orderBy: { _count: { id: 'desc' } },
        take: 20,
      }),
      prisma.memeActivation.count({ where: { channelId } }),
      prisma.memeActivation.aggregate({ where: { channelId }, _sum: { coinsSpent: true } }),
      prisma.meme.count({ where: { channelId, status: 'approved' } }),
      prisma.$queryRaw<Array<{ day: Date; activations: bigint; coins: bigint }>>`
          SELECT date_trunc('day', "createdAt") as day,
                 COUNT(*)::bigint as activations,
                 COALESCE(SUM("coinsSpent"), 0)::bigint as coins
          FROM "MemeActivation"
          WHERE "channelId" = ${channelId}
            AND "createdAt" >= (NOW() - INTERVAL '14 days')
          GROUP BY 1
          ORDER BY 1 ASC
        `,
    ]);

    // Fetch user/meme details (only if needed)
    const userIds = userSpending.map((s) => s.userId);
    const memeIds = memeStats.map((s) => s.memeId);

    const [users, memes] = await Promise.all([
      userIds.length
        ? prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, displayName: true },
          })
        : Promise.resolve([] as Array<{ id: string; displayName: string }>),
      memeIds.length
        ? prisma.meme.findMany({
            where: { id: { in: memeIds } },
            select: { id: true, title: true, priceCoins: true },
          })
        : Promise.resolve([] as Array<{ id: string; title: string; priceCoins: number }>),
    ]);

    const usersById = new Map(users.map((u) => [u.id, u]));
    const memesById = new Map(memes.map((m) => [m.id, m]));

    const userSpendingOut = userSpending.map((s) => ({
      user: usersById.get(s.userId) || { id: s.userId, displayName: 'Unknown' },
      totalCoinsSpent: s._sum.coinsSpent || 0,
      activationsCount: s._count.id,
    }));
    // Stable ordering even when coinsSpent is 0 (e.g., channel-owner free activations).
    userSpendingOut.sort((a, b) => {
      if (b.totalCoinsSpent !== a.totalCoinsSpent) return b.totalCoinsSpent - a.totalCoinsSpent;
      return b.activationsCount - a.activationsCount;
    });

    const memePopularityOut = memeStats.map((s) => ({
      meme: memesById.get(s.memeId) || null,
      activationsCount: s._count.id,
      totalCoinsSpent: s._sum.coinsSpent || 0,
    }));
    memePopularityOut.sort((a, b) => {
      if (b.activationsCount !== a.activationsCount) return b.activationsCount - a.activationsCount;
      return b.totalCoinsSpent - a.totalCoinsSpent;
    });

    const payload = {
      userSpending: userSpendingOut.slice(0, 20),
      memePopularity: memePopularityOut.slice(0, 20),
      overall: {
        totalActivations,
        totalCoinsSpent: totalCoinsSpent._sum.coinsSpent || 0,
        totalMemes,
      },
      daily: daily.map((d) => ({
        day: d.day.toISOString(),
        activations: Number(d.activations),
        coins: Number(d.coins),
      })),
    };

    const body = JSON.stringify(payload);
    const etag = makeEtagFromString(body);
    res.setHeader('ETag', etag);
    if (ifNoneMatchHit(req, etag)) return res.status(304).end();
    channelStatsCache.set(cacheKey, { ts: Date.now(), etag, body });
    if (channelStatsCache.size > CHANNEL_STATS_CACHE_MAX) channelStatsCache.clear();
    return res.type('application/json').send(body);
  } catch (error) {
    throw error;
  }
};


