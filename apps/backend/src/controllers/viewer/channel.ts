import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import {
  channelMetaCache,
  getChannelMetaCacheMs,
  setChannelMetaCacheHeaders,
  makeEtagFromString,
  ifNoneMatchHit,
  CHANNEL_META_CACHE_MAX,
  pruneOldestEntries,
} from './cache.js';
import { nsKey, redisGetString, redisSetStringEx } from '../../utils/redisCache.js';
import { normalizeDashboardCardOrder } from '../../utils/dashboardCardOrder.js';
import { toChannelMemeListItemDto } from './channelMemeListDto.js';

export const getChannelBySlug = async (req: any, res: Response) => {
  const slug = String(req.params.slug || '').trim();
  // Optional parameter to exclude memes from response for performance
  const includeMemes = req.query.includeMemes !== 'false'; // Default to true for backward compatibility

  // Optional pagination for memes when includeMemes=true (defensive cap to protect server/DB).
  const limitRaw = req.query.limit as string | undefined;
  const offsetRaw = req.query.offset as string | undefined;
  const sortByRaw = String(req.query.sortBy || '').trim();
  const sortOrderRaw = String(req.query.sortOrder || '').trim().toLowerCase();
  const maxFromEnv = parseInt(String(process.env.CHANNEL_MEMES_MAX || ''), 10);
  const MAX_MEMES = Number.isFinite(maxFromEnv) && maxFromEnv > 0 ? maxFromEnv : 200;
  const requestedLimit = limitRaw !== undefined ? parseInt(limitRaw, 10) : undefined;
  const requestedOffset = offsetRaw !== undefined ? parseInt(offsetRaw, 10) : undefined;
  const memesLimit = includeMemes
    ? Math.min(MAX_MEMES, Number.isFinite(requestedLimit as number) && (requestedLimit as number) > 0 ? (requestedLimit as number) : MAX_MEMES)
    : 0;
  const memesOffset =
    includeMemes && Number.isFinite(requestedOffset as number) && (requestedOffset as number) > 0 ? (requestedOffset as number) : 0;

  const sortBy = sortByRaw === 'priceCoins' ? 'priceCoins' : 'createdAt';
  const sortOrder = sortOrderRaw === 'asc' ? 'asc' : 'desc';
  const orderBy =
    sortBy === 'priceCoins'
      ? [{ priceCoins: sortOrder }, { createdAt: 'desc' as const }, { id: 'desc' as const }]
      : [{ createdAt: sortOrder }, { id: 'desc' as const }];

  // Cache channel metadata (colors/icons/reward settings) when we are NOT returning memes.
  // Safe because response is not user-personalized.
  const cacheKey = String(slug || '').trim().toLowerCase();
  const canCacheMeta = !req?.userId;
  if (!includeMemes) {
    if (canCacheMeta) {
      setChannelMetaCacheHeaders(req, res);
      const cached = channelMetaCache.get(cacheKey);
      const ttl = getChannelMetaCacheMs();
      if (cached && Date.now() - cached.ts < ttl) {
        if (cached.etag) res.setHeader('ETag', cached.etag);
        if (ifNoneMatchHit(req, cached.etag)) return res.status(304).end();
        return res.json(cached.data);
      }

      // Redis shared cache (optional): reduce DB hits across instances.
      try {
        const rkey = nsKey('channel_meta', cacheKey);
        const body = await redisGetString(rkey);
        if (body) {
          const etag = makeEtagFromString(body);
          res.setHeader('ETag', etag);
          if (ifNoneMatchHit(req, etag)) return res.status(304).end();
          return res.type('application/json').send(body);
        }
      } catch {
        // ignore
      }
    } else {
      // For authenticated dashboard/panel requests we need read-your-writes semantics.
      // Avoid returning stale cached channel settings (e.g., dashboardCardOrder).
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
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
            // Source of truth: ChannelMeme (approved + not deleted).
            // This avoids showing counts for disabled/deleted memes when legacy rows exist.
            channelMemes: { where: { status: 'approved', deletedAt: null } },
            users: true,
          },
        },
      },
    });

    if (!channel) {
      return res.status(404).json({ errorCode: 'CHANNEL_NOT_FOUND', error: 'Channel not found', details: { entity: 'channel', slug } });
    }

    const owner = (channel as any).users?.[0] || null;
    const rawDashboardCardOrder = (channel as any).dashboardCardOrder ?? null;
    const dashboardCardOrder = rawDashboardCardOrder === null ? null : normalizeDashboardCardOrder(rawDashboardCardOrder);
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
      rewardOnlyWhenLive: (channel as any).rewardOnlyWhenLive ?? false,
      // Kick rewards -> coins
      kickRewardEnabled: (channel as any).kickRewardEnabled ?? false,
      kickRewardIdForCoins: (channel as any).kickRewardIdForCoins ?? null,
      kickCoinPerPointRatio: (channel as any).kickCoinPerPointRatio ?? 1.0,
      kickRewardCoins: (channel as any).kickRewardCoins ?? null,
      kickRewardOnlyWhenLive: (channel as any).kickRewardOnlyWhenLive ?? false,
      // Trovo spells -> coins
      trovoManaCoinsPerUnit: (channel as any).trovoManaCoinsPerUnit ?? 0,
      trovoElixirCoinsPerUnit: (channel as any).trovoElixirCoinsPerUnit ?? 0,
      // VKVideo channel points -> coins
      vkvideoRewardEnabled: (channel as any).vkvideoRewardEnabled ?? false,
      vkvideoRewardIdForCoins: (channel as any).vkvideoRewardIdForCoins ?? null,
      vkvideoCoinPerPointRatio: (channel as any).vkvideoCoinPerPointRatio ?? 1.0,
      vkvideoRewardCoins: (channel as any).vkvideoRewardCoins ?? null,
      vkvideoRewardOnlyWhenLive: (channel as any).vkvideoRewardOnlyWhenLive ?? false,
      submissionRewardCoins: (channel as any).submissionRewardCoins ?? 0,
      submissionRewardOnlyWhenLive: (channel as any).submissionRewardOnlyWhenLive ?? false,
      submissionsEnabled: (channel as any).submissionsEnabled ?? true,
      submissionsOnlyWhenLive: (channel as any).submissionsOnlyWhenLive ?? false,
      coinIconUrl: (channel as any).coinIconUrl ?? null,
      primaryColor: (channel as any).primaryColor ?? null,
      secondaryColor: (channel as any).secondaryColor ?? null,
      accentColor: (channel as any).accentColor ?? null,
      dashboardCardOrder,
      createdAt: channel.createdAt,
      owner: owner
        ? {
            id: owner.id,
            displayName: owner.displayName,
            profileImageUrl: owner.profileImageUrl,
          }
        : null,
      stats: {
        memesCount: (channel as any)._count.channelMemes,
        usersCount: (channel as any)._count.users,
      },
    };

    // Only include memes if includeMemes is true
    if (includeMemes) {
      // IMPORTANT: Channel-scoped visibility source of truth is ChannelMeme (status=approved, deletedAt=null).
      // This prevents "resurrection" if legacy Meme rows exist for back-compat.
      const rows = await prisma.channelMeme.findMany({
        where: { channelId: channel.id, status: 'approved', deletedAt: null },
        orderBy: orderBy as any,
        take: memesLimit,
        skip: memesOffset,
        select: {
          id: true,
          legacyMemeId: true,
          memeAssetId: true,
          title: true,
          priceCoins: true,
          status: true,
          createdAt: true,
          memeAsset: {
            select: {
              type: true,
              fileUrl: true,
              fileHash: true,
              durationMs: true,
              createdBy: { select: { id: true, displayName: true } },
            },
          },
        },
      });

      response.memes = rows.map((r) => toChannelMemeListItemDto(req, channel.id, r as any));
      response.memesPage = {
        limit: memesLimit,
        offset: memesOffset,
        returned: Array.isArray(response.memes) ? response.memes.length : 0,
        total: (channel as any)._count.channelMemes,
      };
    }

    if (!includeMemes && canCacheMeta) {
      const body = JSON.stringify(response);
      const etag = makeEtagFromString(body);
      res.setHeader('ETag', etag);
      if (ifNoneMatchHit(req, etag)) {
        channelMetaCache.set(cacheKey, { ts: Date.now(), data: response, etag });
        pruneOldestEntries(channelMetaCache, CHANNEL_META_CACHE_MAX);
        void redisSetStringEx(nsKey('channel_meta', cacheKey), Math.ceil(getChannelMetaCacheMs() / 1000), body);
        return res.status(304).end();
      }
      channelMetaCache.set(cacheKey, { ts: Date.now(), data: response, etag });
      pruneOldestEntries(channelMetaCache, CHANNEL_META_CACHE_MAX);
      void redisSetStringEx(nsKey('channel_meta', cacheKey), Math.ceil(getChannelMetaCacheMs() / 1000), body);
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
        submissionsEnabled: true,
        submissionsOnlyWhenLive: false,
        primaryColor: null,
        secondaryColor: null,
        accentColor: null,
        dashboardCardOrder: null,
        createdAt: channel[0].createdAt,
        stats: {
          memesCount,
          usersCount,
        },
      };

      // Only include memes if includeMemes is true
      if (includeMemes) {
        // Fallback path (legacy schema): keep legacy behavior.
        // Note: this branch is only used on older DBs missing columns; ChannelMeme may also be missing there.
        response.memes = memes;
        response.memesPage = {
          limit: memesLimit,
          offset: memesOffset,
          returned: Array.isArray(memes) ? memes.length : 0,
          total: memesCount,
        };
      }

      if (!includeMemes && canCacheMeta) {
        setChannelMetaCacheHeaders(req, res);
        const body = JSON.stringify(response);
        const etag = makeEtagFromString(body);
        res.setHeader('ETag', etag);
        channelMetaCache.set(cacheKey, { ts: Date.now(), data: response, etag });
        pruneOldestEntries(channelMetaCache, CHANNEL_META_CACHE_MAX);
        void redisSetStringEx(nsKey('channel_meta', cacheKey), Math.ceil(getChannelMetaCacheMs() / 1000), body);
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

  const sortByRaw = String(req.query.sortBy || '').trim();
  const sortOrderRaw = String(req.query.sortOrder || '').trim().toLowerCase();
  const sortBy = sortByRaw === 'priceCoins' ? 'priceCoins' : 'createdAt';
  const sortOrder = sortOrderRaw === 'asc' ? 'asc' : 'desc';
  const orderBy =
    sortBy === 'priceCoins'
      ? [{ priceCoins: sortOrder }, { createdAt: 'desc' as const }, { id: 'desc' as const }]
      : [{ createdAt: sortOrder }, { id: 'desc' as const }];

  // Cacheable on production (public). On beta it's gated via auth; still safe but keep it private.
  if (req?.userId) res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  else res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');

  if (!slug) {
    return res.status(400).json({ errorCode: 'BAD_REQUEST', error: 'Bad request', details: { field: 'slug' } });
  }

  const channel = await prisma.channel.findFirst({
    where: { slug: { equals: slug, mode: 'insensitive' } },
    select: { id: true, slug: true },
  });

  if (!channel) {
    return res.status(404).json({ errorCode: 'CHANNEL_NOT_FOUND', error: 'Channel not found', details: { entity: 'channel', slug } });
  }

  // IMPORTANT: channel-scoped visibility must follow ChannelMeme, not legacy Meme.
  // This prevents deleted/disabled channel memes from "resurrecting" via legacy reads.
  const rows = await prisma.channelMeme.findMany({
    where: {
      channelId: channel.id,
      status: 'approved',
      deletedAt: null,
    },
    include: {
      memeAsset: {
        include: {
          createdBy: {
            select: {
              id: true,
              displayName: true,
            },
          },
        },
      },
    },
    orderBy: orderBy as any,
    take: limit,
    skip: offset,
  });

  const memes = rows.map((r) => toChannelMemeListItemDto(req, channel.id, r as any));

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


