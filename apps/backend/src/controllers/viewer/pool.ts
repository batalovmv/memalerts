import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import {
  clampInt,
  getSearchCacheMs,
  ifNoneMatchHit,
  makeEtagFromString,
  SEARCH_CACHE_MAX,
  searchCache,
  setSearchCacheHeaders,
} from './search/cache.js';
import { nsKey, redisGetString, redisSetStringEx } from '../../utils/redisCache.js';

export const getMemePool = async (req: any, res: Response) => {
  const qRaw = req.query.q ? String(req.query.q).trim() : '';
  const q = qRaw.length > 100 ? qRaw.slice(0, 100) : qRaw;
  const limitRaw = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
  const offsetRaw = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;

  const maxFromEnv = parseInt(String(process.env.SEARCH_PAGE_MAX || ''), 10);
  const MAX_PAGE = Number.isFinite(maxFromEnv) && maxFromEnv > 0 ? maxFromEnv : 50;
  const limit = clampInt(limitRaw, 1, MAX_PAGE, 50);
  const offset = clampInt(offsetRaw, 0, 1_000_000, 0);

  // Non-personalized → allow short cache + ETag/304
  setSearchCacheHeaders(req, res);

  const cacheKey = ['pool', 'v1', q.toLowerCase(), String(limit), String(offset)].join('|');

  const ttl = getSearchCacheMs();
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ttl) {
    res.setHeader('ETag', cached.etag);
    if (ifNoneMatchHit(req, cached.etag)) return res.status(304).end();
    return res.type('application/json').send(cached.body);
  }

  // Redis shared cache (optional)
  try {
    const rkey = nsKey('search', cacheKey);
    const body = await redisGetString(rkey);
    if (body) {
      const etag = makeEtagFromString(body);
      res.setHeader('ETag', etag);
      if (ifNoneMatchHit(req, etag)) return res.status(304).end();
      searchCache.set(cacheKey, { ts: Date.now(), body, etag });
      if (searchCache.size > SEARCH_CACHE_MAX) searchCache.clear();
      return res.type('application/json').send(body);
    }
  } catch {
    // ignore
  }

  const where: any = {
    poolVisibility: 'visible',
    purgedAt: null,
    channelMemes: {
      some: {
        status: 'approved',
        deletedAt: null,
        ...(q
          ? {
              title: {
                contains: q,
                mode: 'insensitive',
              },
            }
          : {}),
      },
    },
  };

  // Order by most recently created asset; later можно заменить на popularity rollups.
  const rows = await prisma.memeAsset.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
    select: {
      id: true,
      type: true,
      fileUrl: true,
      durationMs: true,
      createdAt: true,
      _count: {
        select: {
          channelMemes: true,
        },
      },
      channelMemes: {
        where: { status: 'approved', deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          title: true,
          priceCoins: true,
          channelId: true,
        },
      },
    },
  });

  const items = rows.map((r) => ({
    id: r.id,
    type: r.type,
    fileUrl: r.fileUrl,
    durationMs: r.durationMs,
    createdAt: r.createdAt,
    usageCount: r._count.channelMemes,
    sampleTitle: r.channelMemes?.[0]?.title ?? null,
    samplePriceCoins: r.channelMemes?.[0]?.priceCoins ?? null,
  }));

  // Cache (best-effort)
  try {
    const body = JSON.stringify(items);
    const etag = makeEtagFromString(body);
    searchCache.set(cacheKey, { ts: Date.now(), body, etag });
    if (searchCache.size > SEARCH_CACHE_MAX) searchCache.clear();
    void redisSetStringEx(nsKey('search', cacheKey), Math.ceil(getSearchCacheMs() / 1000), body);
    res.setHeader('ETag', etag);
    if (ifNoneMatchHit(req, etag)) return res.status(304).end();
    return res.type('application/json').send(body);
  } catch {
    // fall through
  }

  return res.json(items);
};


