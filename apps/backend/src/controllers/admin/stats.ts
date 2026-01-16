import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import crypto from 'crypto';

type ChannelStatsCacheEntry = { ts: number; etag: string; body: string };
const channelStatsCache = new Map<string, ChannelStatsCacheEntry>();
const CHANNEL_STATS_CACHE_MS_DEFAULT = 30_000;
const CHANNEL_STATS_CACHE_MAX = 200;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function getChannelStatsCacheMs(): number {
  const raw = parseInt(String(process.env.ADMIN_STATS_CACHE_MS || ''), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : CHANNEL_STATS_CACHE_MS_DEFAULT;
}

function makeEtagFromString(body: string): string {
  const hash = crypto.createHash('sha1').update(body).digest('base64');
  return `"${hash}"`;
}

function ifNoneMatchHit(req: { headers?: Record<string, string | string[] | undefined> }, etag: string): boolean {
  const inm = req.headers?.['if-none-match'];
  if (!inm) return false;
  const raw = Array.isArray(inm) ? inm.join(',') : String(inm);
  return raw
    .split(',')
    .map((s) => s.trim())
    .includes(etag);
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

    const toNumberSafe = (v: unknown): number => {
      if (typeof v === 'number') return v;
      if (typeof v === 'bigint') return Number(v);
      return 0;
    };

    // Daily series: prefer rollup table (fast), fallback to raw SQL for older deployments.
    const dailyStart = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    type RollupClient = {
      channelDailyStats: { findMany: (args: unknown) => Promise<unknown[]> };
      channelUserStats30d: { findMany: (args: unknown) => Promise<unknown[]> };
      channelMemeStats30d: { findMany: (args: unknown) => Promise<unknown[]> };
    };
    const prismaRollups = prisma as unknown as RollupClient;

    const dailyPromise = (async () => {
      try {
        const rows = await prismaRollups.channelDailyStats.findMany({
          where: { channelId, day: { gte: dailyStart } },
          orderBy: { day: 'asc' },
          select: {
            day: true,
            totalActivationsCount: true,
            totalCoinsSpentSum: true,
          },
        });
        return rows.map((r) => {
          const rec = asRecord(r);
          return {
            day: (rec.day as Date).toISOString(),
            activations: toNumberSafe(rec.totalActivationsCount),
            coins: toNumberSafe(rec.totalCoinsSpentSum),
            source: 'rollup',
          };
        });
      } catch (e: unknown) {
        // Back-compat: table might not exist in older DBs.
        const errorRec = asRecord(e);
        const metaRec = asRecord(errorRec.meta);
        if (errorRec.code === 'P2021' && String(metaRec.table || '').includes('ChannelDailyStats')) {
          const rows = await prisma.$queryRaw<Array<{ day: Date; activations: bigint; coins: bigint }>>`
            SELECT date_trunc('day', "createdAt") as day,
                   COUNT(*)::bigint as activations,
                   COALESCE(SUM("coinsSpent"), 0)::bigint as coins
            FROM "MemeActivation"
            WHERE "channelId" = ${channelId}
              AND "createdAt" >= (NOW() - INTERVAL '14 days')
            GROUP BY 1
            ORDER BY 1 ASC
          `;
          return rows.map((d) => ({
            day: d.day.toISOString(),
            activations: Number(d.activations),
            coins: Number(d.coins),
            source: 'raw',
          }));
        }
        throw e;
      }
    })();

    // Top lists: prefer 30d rollups (cheap), fallback to live groupBy on older deployments.
    const userSpendingPromise = (async () => {
      try {
        const rows = await prismaRollups.channelUserStats30d.findMany({
          where: { channelId },
          orderBy: [{ totalCoinsSpentSum: 'desc' }, { totalActivationsCount: 'desc' }],
          take: 20,
          select: {
            userId: true,
            totalCoinsSpentSum: true,
            totalActivationsCount: true,
          },
        });
        return { rows, source: 'rollup' as const };
      } catch (e: unknown) {
        const errorRec = asRecord(e);
        const metaRec = asRecord(errorRec.meta);
        if (errorRec.code === 'P2021' && String(metaRec.table || '').includes('ChannelUserStats30d')) {
          const rows = await prisma.memeActivation.groupBy({
            by: ['userId'],
            where: { channelId },
            _sum: { coinsSpent: true },
            _count: { id: true },
            orderBy: { _sum: { coinsSpent: 'desc' } },
            take: 20,
          });
          return { rows, source: 'raw' as const };
        }
        throw e;
      }
    })();

    const memeStatsPromise = (async () => {
      try {
        const rows = await prismaRollups.channelMemeStats30d.findMany({
          where: { channelId },
          orderBy: [{ totalActivationsCount: 'desc' }, { totalCoinsSpentSum: 'desc' }],
          take: 20,
          select: {
            memeId: true,
            totalActivationsCount: true,
            totalCoinsSpentSum: true,
          },
        });
        return { rows, source: 'rollup' as const };
      } catch (e: unknown) {
        const errorRec = asRecord(e);
        const metaRec = asRecord(errorRec.meta);
        if (errorRec.code === 'P2021' && String(metaRec.table || '').includes('ChannelMemeStats30d')) {
          const rows = await prisma.memeActivation.groupBy({
            by: ['memeId'],
            where: { channelId },
            _count: { id: true },
            _sum: { coinsSpent: true },
            orderBy: { _count: { id: 'desc' } },
            take: 20,
          });
          return { rows, source: 'raw' as const };
        }
        throw e;
      }
    })();

    const [userSpendingRes, memeStatsRes, totalActivations, totalCoinsSpent, totalMemes, daily] = await Promise.all([
      userSpendingPromise,
      memeStatsPromise,
      prisma.memeActivation.count({ where: { channelId } }),
      prisma.memeActivation.aggregate({ where: { channelId }, _sum: { coinsSpent: true } }),
      prisma.meme.count({ where: { channelId, status: 'approved' } }),
      dailyPromise,
    ]);

    // Fetch user/meme details (only if needed)
    const userIds = userSpendingRes.rows.map((s) => String(asRecord(s).userId || '')).filter((id) => id);
    const memeIds = memeStatsRes.rows.map((s) => String(asRecord(s).memeId || '')).filter((id) => id);

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

    type UserSpendingOut = {
      user: { id: string; displayName: string };
      totalCoinsSpent: number;
      activationsCount: number;
    };
    const userSpendingOut: UserSpendingOut[] = userSpendingRes.rows.map((s) => {
      const rec = asRecord(s);
      const sumRec = asRecord(rec._sum);
      const countRec = asRecord(rec._count);
      const userId = String(rec.userId || '');
      return {
        user: usersById.get(userId) || { id: userId, displayName: 'Unknown' },
        totalCoinsSpent:
          typeof rec.totalCoinsSpentSum === 'number' ? rec.totalCoinsSpentSum : Number(sumRec.coinsSpent || 0),
        activationsCount:
          typeof rec.totalActivationsCount === 'number' ? rec.totalActivationsCount : Number(countRec.id || 0),
      };
    });
    // Stable ordering even when coinsSpent is 0 (e.g., channel-owner free activations).
    userSpendingOut.sort((a, b) => {
      if (b.totalCoinsSpent !== a.totalCoinsSpent) return b.totalCoinsSpent - a.totalCoinsSpent;
      return b.activationsCount - a.activationsCount;
    });

    type MemePopularityOut = {
      meme: { id: string; title: string; priceCoins: number } | null;
      activationsCount: number;
      totalCoinsSpent: number;
    };
    const memePopularityOut: MemePopularityOut[] = memeStatsRes.rows.map((s) => {
      const rec = asRecord(s);
      const sumRec = asRecord(rec._sum);
      const countRec = asRecord(rec._count);
      const memeId = String(rec.memeId || '');
      return {
        meme: memesById.get(memeId) || null,
        activationsCount:
          typeof rec.totalActivationsCount === 'number' ? rec.totalActivationsCount : Number(countRec.id || 0),
        totalCoinsSpent:
          typeof rec.totalCoinsSpentSum === 'number' ? rec.totalCoinsSpentSum : Number(sumRec.coinsSpent || 0),
      };
    });
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
      daily,
      rollup: {
        // Informational: helps debugging/perf tuning without breaking clients.
        windowDays: 30,
        userSpendingSource: userSpendingRes.source,
        memePopularitySource: memeStatsRes.source,
      },
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
