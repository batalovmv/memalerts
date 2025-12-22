import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import {
  channelMetaCache,
  getChannelMetaCacheMs,
  setChannelMetaCacheHeaders,
  makeEtagFromString,
  ifNoneMatchHit,
} from './cache.js';

export const getChannelBySlug = async (req: any, res: Response) => {
  const slug = String(req.params.slug || '').trim();
  // Optional parameter to exclude memes from response for performance
  const includeMemes = req.query.includeMemes !== 'false'; // Default to true for backward compatibility

  // Optional pagination for memes when includeMemes=true (defensive cap to protect server/DB).
  const limitRaw = req.query.limit as string | undefined;
  const offsetRaw = req.query.offset as string | undefined;
  const maxFromEnv = parseInt(String(process.env.CHANNEL_MEMES_MAX || ''), 10);
  const MAX_MEMES = Number.isFinite(maxFromEnv) && maxFromEnv > 0 ? maxFromEnv : 200;
  const requestedLimit = limitRaw !== undefined ? parseInt(limitRaw, 10) : undefined;
  const requestedOffset = offsetRaw !== undefined ? parseInt(offsetRaw, 10) : undefined;
  const memesLimit = includeMemes
    ? Math.min(MAX_MEMES, Number.isFinite(requestedLimit as number) && (requestedLimit as number) > 0 ? (requestedLimit as number) : MAX_MEMES)
    : 0;
  const memesOffset =
    includeMemes && Number.isFinite(requestedOffset as number) && (requestedOffset as number) > 0 ? (requestedOffset as number) : 0;

  // Cache channel metadata (colors/icons/reward settings) when we are NOT returning memes.
  // Safe because response is not user-personalized.
  const cacheKey = String(slug || '').trim().toLowerCase();
  if (!includeMemes) {
    setChannelMetaCacheHeaders(req, res);
    const cached = channelMetaCache.get(cacheKey);
    const ttl = getChannelMetaCacheMs();
    if (cached && Date.now() - cached.ts < ttl) {
      if (cached.etag) res.setHeader('ETag', cached.etag);
      if (ifNoneMatchHit(req, cached.etag)) return res.status(304).end();
      return res.json(cached.data);
    }
  }

  try {
    const channel = await prisma.channel.findFirst({
      where: {
        slug: {
          equals: slug,
          mode: 'insensitive',
        },
      },
      include: {
        memes: includeMemes
          ? {
              where: { status: 'approved' },
              orderBy: { createdAt: 'desc' },
              take: memesLimit,
              skip: memesOffset,
              select: {
                id: true,
                title: true,
                type: true,
                fileUrl: true,
                durationMs: true,
                priceCoins: true,
                createdAt: true,
              },
            }
          : false,
        users: {
          where: { role: 'streamer' },
          take: 1,
          select: {
            id: true,
            displayName: true,
            profileImageUrl: true,
          },
        },
        _count: {
          select: {
            memes: { where: { status: 'approved' } },
            users: true,
          },
        },
      },
    });

    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const owner = (channel as any).users?.[0] || null;
    const response: any = {
      id: channel.id,
      slug: channel.slug,
      name: channel.name,
      coinPerPointRatio: channel.coinPerPointRatio,
      overlayMode: (channel as any).overlayMode ?? 'queue',
      overlayShowSender: (channel as any).overlayShowSender ?? false,
      overlayMaxConcurrent: (channel as any).overlayMaxConcurrent ?? 3,
      rewardIdForCoins: (channel as any).rewardIdForCoins ?? null,
      rewardEnabled: (channel as any).rewardEnabled ?? false,
      rewardTitle: (channel as any).rewardTitle ?? null,
      rewardCost: (channel as any).rewardCost ?? null,
      rewardCoins: (channel as any).rewardCoins ?? null,
      submissionRewardCoins: (channel as any).submissionRewardCoins ?? 0,
      coinIconUrl: (channel as any).coinIconUrl ?? null,
      primaryColor: (channel as any).primaryColor ?? null,
      secondaryColor: (channel as any).secondaryColor ?? null,
      accentColor: (channel as any).accentColor ?? null,
      createdAt: channel.createdAt,
      owner: owner
        ? {
            id: owner.id,
            displayName: owner.displayName,
            profileImageUrl: owner.profileImageUrl,
          }
        : null,
      stats: {
        memesCount: (channel as any)._count.memes,
        usersCount: (channel as any)._count.users,
      },
    };

    // Only include memes if includeMemes is true
    if (includeMemes) {
      response.memes = (channel as any).memes || [];
      response.memesPage = {
        limit: memesLimit,
        offset: memesOffset,
        returned: Array.isArray(response.memes) ? response.memes.length : 0,
        total: (channel as any)._count.memes,
      };
    }

    if (!includeMemes) {
      const body = JSON.stringify(response);
      const etag = makeEtagFromString(body);
      res.setHeader('ETag', etag);
      if (ifNoneMatchHit(req, etag)) {
        channelMetaCache.set(cacheKey, { ts: Date.now(), data: response, etag });
        return res.status(304).end();
      }
      channelMetaCache.set(cacheKey, { ts: Date.now(), data: response, etag });
      return res.type('application/json').send(body);
    }

    res.json(response);
  } catch (error: any) {
    // If error is about missing columns, try query without color fields
    if (error.message && error.message.includes('does not exist')) {
      const channel =
        (await prisma.$queryRaw`
          SELECT id, slug, name, "coinPerPointRatio", "createdAt"
          FROM "Channel"
          WHERE slug = ${slug}
        `) as any[];

      if (!channel || channel.length === 0) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      const memes = await prisma.meme.findMany({
        where: {
          channelId: channel[0].id,
          status: 'approved',
        },
        orderBy: { createdAt: 'desc' },
        take: includeMemes ? memesLimit : undefined,
        skip: includeMemes ? memesOffset : undefined,
        select: {
          id: true,
          title: true,
          type: true,
          fileUrl: true,
          durationMs: true,
          priceCoins: true,
          createdAt: true,
        },
      });

      const memesCount = await prisma.meme.count({
        where: {
          channelId: channel[0].id,
          status: 'approved',
        },
      });

      const usersCount = await prisma.user.count({
        where: { channelId: channel[0].id },
      });

      const response: any = {
        id: channel[0].id,
        slug: channel[0].slug,
        name: channel[0].name,
        coinPerPointRatio: channel[0].coinPerPointRatio,
        submissionRewardCoins: 0,
        primaryColor: null,
        secondaryColor: null,
        accentColor: null,
        createdAt: channel[0].createdAt,
        stats: {
          memesCount,
          usersCount,
        },
      };

      // Only include memes if includeMemes is true
      if (includeMemes) {
        response.memes = memes;
        response.memesPage = {
          limit: memesLimit,
          offset: memesOffset,
          returned: Array.isArray(memes) ? memes.length : 0,
          total: memesCount,
        };
      }

      if (!includeMemes) {
        setChannelMetaCacheHeaders(req, res);
        const body = JSON.stringify(response);
        const etag = makeEtagFromString(body);
        res.setHeader('ETag', etag);
        channelMetaCache.set(cacheKey, { ts: Date.now(), data: response, etag });
        if (ifNoneMatchHit(req, etag)) return res.status(304).end();
        return res.type('application/json').send(body);
      }
      return res.json(response);
    }
    throw error;
  }
};

// Public: list approved memes for a channel by slug (supports pagination)
export const getChannelMemesPublic = async (req: any, res: Response) => {
  const slug = String(req.params.slug || '').trim();

  const maxFromEnv = parseInt(String(process.env.CHANNEL_MEMES_PAGE_MAX || ''), 10);
  const MAX_PAGE = Number.isFinite(maxFromEnv) && maxFromEnv > 0 ? maxFromEnv : 50;
  const limitRaw = req.query.limit ? parseInt(req.query.limit as string, 10) : 30;
  const offsetRaw = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_PAGE) : 30;
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

  // Cacheable on production (public). On beta it's gated via auth; still safe but keep it private.
  if (req?.userId) res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  else res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');

  if (!slug) {
    return res.status(400).json({ error: 'Channel slug is required' });
  }

  const channel = await prisma.channel.findFirst({
    where: { slug: { equals: slug, mode: 'insensitive' } },
    select: { id: true, slug: true },
  });

  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }

  const memes = await prisma.meme.findMany({
    where: {
      channelId: channel.id,
      status: 'approved',
    },
    include: {
      createdBy: {
        select: {
          id: true,
          displayName: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });

  try {
    const body = JSON.stringify(memes);
    const etag = makeEtagFromString(body);
    res.setHeader('ETag', etag);
    if (ifNoneMatchHit(req, etag)) return res.status(304).end();
    return res.type('application/json').send(body);
  } catch {
    return res.json(memes);
  }
};


