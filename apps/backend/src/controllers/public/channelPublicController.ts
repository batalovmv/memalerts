import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { toPublicChannelMemeListItemDto } from './dto/publicChannelMemeListItemDto.js';
import {
  channelMetaCache,
  getChannelMetaCacheMs,
  ifNoneMatchHit,
  makeEtagFromString,
  pruneOldestEntries,
  setChannelMetaCacheHeaders,
  CHANNEL_META_CACHE_MAX,
} from '../viewer/cache.js';
import { nsKey, redisGetString, redisSetStringEx } from '../../utils/redisCache.js';

// GET /public/channels/:slug?includeMemes=false
export const getPublicChannelBySlug = async (req: any, res: Response) => {
  const slug = String(req.params.slug || '').trim();
  const includeMemes = String(req.query.includeMemes || '').toLowerCase() === 'true';

  // Optional pagination for memes when includeMemes=true (defensive cap).
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

  // Cache channel meta when includeMemes=false (safe: not personalized).
  const cacheKey = String(slug || '').trim().toLowerCase();
  const canCacheMeta = !req?.userId;
  if (!includeMemes && canCacheMeta) {
    setChannelMetaCacheHeaders(req, res);
    const cached = channelMetaCache.get(cacheKey);
    const ttl = getChannelMetaCacheMs();
    if (cached && Date.now() - cached.ts < ttl) {
      if (cached.etag) res.setHeader('ETag', cached.etag);
      if (ifNoneMatchHit(req, cached.etag)) return res.status(304).end();
      return res.json(cached.data);
    }

    // Redis shared cache (optional)
    try {
      const rkey = nsKey('public_channel_meta', cacheKey);
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
  } else if (!includeMemes && !canCacheMeta) {
    // If authenticated on a public endpoint (e.g., beta), keep it private and fresh.
    res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  }

  const channel = await prisma.channel.findFirst({
    where: { slug: { equals: slug, mode: 'insensitive' } },
    include: {
      users: {
        where: { role: 'streamer' },
        take: 1,
        select: { id: true, displayName: true, profileImageUrl: true },
      },
      _count: {
        select: {
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

  const response: any = {
    id: channel.id,
    slug: channel.slug,
    name: channel.name,
    coinIconUrl: (channel as any).coinIconUrl ?? null,
    primaryColor: (channel as any).primaryColor ?? null,
    secondaryColor: (channel as any).secondaryColor ?? null,
    accentColor: (channel as any).accentColor ?? null,

    // Submissions / rewards
    rewardTitle: (channel as any).rewardTitle ?? null,
    rewardOnlyWhenLive: (channel as any).rewardOnlyWhenLive ?? false,
    submissionRewardCoins: (channel as any).submissionRewardCoins ?? 0,
    submissionRewardOnlyWhenLive: (channel as any).submissionRewardOnlyWhenLive ?? false,
    submissionsEnabled: (channel as any).submissionsEnabled ?? true,
    submissionsOnlyWhenLive: (channel as any).submissionsOnlyWhenLive ?? false,

    owner: owner ? { id: owner.id, displayName: owner.displayName, profileImageUrl: owner.profileImageUrl } : null,
    stats: {
      memesCount: (channel as any)._count.channelMemes,
      usersCount: (channel as any)._count.users,
    },
  };

  if (includeMemes) {
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
            durationMs: true,
            createdBy: { select: { id: true, displayName: true } },
          },
        },
      },
    });

    response.memes = rows.map((r) => toPublicChannelMemeListItemDto(channel.id, r as any));
    response.memesPage = {
      limit: memesLimit,
      offset: memesOffset,
      returned: Array.isArray(response.memes) ? response.memes.length : 0,
      total: (channel as any)._count.channelMemes,
    };
  }

  if (!includeMemes && canCacheMeta) {
    try {
      const body = JSON.stringify(response);
      const etag = makeEtagFromString(body);
      res.setHeader('ETag', etag);
      if (ifNoneMatchHit(req, etag)) {
        channelMetaCache.set(cacheKey, { ts: Date.now(), data: response, etag });
        pruneOldestEntries(channelMetaCache, CHANNEL_META_CACHE_MAX);
        void redisSetStringEx(nsKey('public_channel_meta', cacheKey), Math.ceil(getChannelMetaCacheMs() / 1000), body);
        return res.status(304).end();
      }
      channelMetaCache.set(cacheKey, { ts: Date.now(), data: response, etag });
      pruneOldestEntries(channelMetaCache, CHANNEL_META_CACHE_MAX);
      void redisSetStringEx(nsKey('public_channel_meta', cacheKey), Math.ceil(getChannelMetaCacheMs() / 1000), body);
      return res.type('application/json').send(body);
    } catch {
      // fall through
    }
  }

  return res.json(response);
};

// GET /public/channels/:slug/memes?limit&offset&sortBy&sortOrder
export const getPublicChannelMemes = async (req: any, res: Response) => {
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

  // Cacheable on production (public). On beta it's gated; still safe but keep it private.
  if (req?.userId) res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  else res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');

  if (!slug) return res.status(400).json({ errorCode: 'BAD_REQUEST', error: 'Bad request', details: { field: 'slug' } });

  const channel = await prisma.channel.findFirst({
    where: { slug: { equals: slug, mode: 'insensitive' } },
    select: { id: true, slug: true },
  });
  if (!channel) return res.status(404).json({ errorCode: 'CHANNEL_NOT_FOUND', error: 'Channel not found', details: { entity: 'channel', slug } });

  const rows = await prisma.channelMeme.findMany({
    where: { channelId: channel.id, status: 'approved', deletedAt: null },
    orderBy: orderBy as any,
    take: limit,
    skip: offset,
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
          durationMs: true,
          createdBy: { select: { id: true, displayName: true } },
        },
      },
    },
  });

  const memes = rows.map((r) => toPublicChannelMemeListItemDto(channel.id, r as any));

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

// GET /public/channels/:slug/memes/search?q&limit&offset&sortBy&sortOrder
// NOTE: public search is implemented against ChannelMeme.title (and optionally uploader displayName)
// to avoid leaking internal fields from legacy Meme search responses.
export const searchPublicChannelMemes = async (req: any, res: Response) => {
  const slug = String(req.params.slug || '').trim();
  const q = String(req.query.q || '').trim().slice(0, 100);

  const maxFromEnv = parseInt(String(process.env.SEARCH_PAGE_MAX || ''), 10);
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

  if (req?.userId) res.setHeader('Cache-Control', 'private, max-age=20, stale-while-revalidate=40');
  else res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');

  if (!slug) return res.status(400).json({ errorCode: 'BAD_REQUEST', error: 'Bad request', details: { field: 'slug' } });

  const channel = await prisma.channel.findFirst({
    where: { slug: { equals: slug, mode: 'insensitive' } },
    select: { id: true },
  });
  if (!channel) return res.status(404).json({ errorCode: 'CHANNEL_NOT_FOUND', error: 'Channel not found', details: { entity: 'channel', slug } });

  const where: any = { channelId: channel.id, status: 'approved', deletedAt: null };
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      // Hidden search-only text (includes AI description when present).
      { searchText: { contains: q, mode: 'insensitive' } },
      { memeAsset: { createdBy: { displayName: { contains: q, mode: 'insensitive' } } } },
    ];
  }

  const rows = await prisma.channelMeme.findMany({
    where,
    orderBy: orderBy as any,
    take: limit,
    skip: offset,
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
          durationMs: true,
          createdBy: { select: { id: true, displayName: true } },
        },
      },
    },
  });

  const items = rows.map((r) => toPublicChannelMemeListItemDto(channel.id, r as any));
  try {
    const body = JSON.stringify(items);
    const etag = makeEtagFromString(body);
    res.setHeader('ETag', etag);
    if (ifNoneMatchHit(req, etag)) return res.status(304).end();
    return res.type('application/json').send(body);
  } catch {
    return res.json(items);
  }
};


