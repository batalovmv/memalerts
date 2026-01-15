import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import type { AuthRequest } from '../../../middleware/auth.js';
import {
  getSearchCacheMs,
  ifNoneMatchHit,
  makeEtagFromString,
  searchCache,
  SEARCH_CACHE_MAX,
} from '../cache.js';
import { nsKey, redisSetStringEx } from '../../../utils/redisCache.js';

export type SearchRequest = AuthRequest & { __searchCacheKey?: string };

export type PoolAssetRow = {
  id: string;
  type: string;
  fileUrl: string | null;
  durationMs: number;
  createdAt: Date;
  aiAutoTitle: string | null;
  createdBy: { id: string; displayName: string } | null;
  channelMemes: Array<{ title: string; priceCoins: number } | null>;
};

export type ChannelMemeRow = {
  id: string;
  legacyMemeId: string | null;
  memeAssetId: string;
  title: string;
  searchText: string | null;
  aiAutoDescription: string | null;
  aiAutoTagNamesJson: unknown | null;
  priceCoins: number;
  status: string;
  createdAt: Date;
  memeAsset: {
    type: string;
    fileUrl: string | null;
    fileHash: string | null;
    durationMs: number;
    createdBy: { id: string; displayName: string } | null;
  };
};

export type SearchContext = {
  req: SearchRequest;
  res: Response;
  targetChannelId: string | null;
  targetChannel: { id: string; memeCatalogMode: string | null; defaultPriceCoins: number | null; slug: string | null } | null;
  memeCatalogMode: string;
  minPrice: unknown;
  maxPrice: unknown;
  qStr: string;
  tagsStr: string;
  includeUploaderEnabled: boolean;
  favoritesEnabled: boolean;
  sortByStr: string;
  sortOrderStr: Prisma.SortOrder;
  parsedLimit: number;
  parsedOffset: number;
};

export function sendSearchResponse(req: SearchRequest, res: Response, payload: unknown) {
  try {
    const body = JSON.stringify(payload);
    const etag = makeEtagFromString(body);
    const cacheKey = req.__searchCacheKey;
    if (cacheKey) {
      searchCache.set(cacheKey, { ts: Date.now(), body, etag });
      if (searchCache.size > SEARCH_CACHE_MAX) searchCache.clear();
      void redisSetStringEx(nsKey('search', cacheKey), Math.ceil(getSearchCacheMs() / 1000), body);
    }
    res.setHeader('ETag', etag);
    if (ifNoneMatchHit(req, etag)) return res.status(304).end();
    return res.type('application/json').send(body);
  } catch {
    return res.json(payload);
  }
}
