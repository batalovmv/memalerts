import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import {
  clampInt,
  getSearchCacheMs,
  ifNoneMatchHit,
  makeEtagFromString,
  parseTagNames,
  SEARCH_CACHE_MAX,
  searchCache,
  setSearchCacheHeaders,
} from './cache.js';
import { nsKey, redisGetString } from '../../utils/redisCache.js';
import type { AuthRequest } from '../../middleware/auth.js';
import {
  handleChannelListingMode,
  handleChannelSearchMode,
  handlePoolAllChannelFilterMode,
} from './search/searchModes.js';
import { handleLegacySearch } from './search/searchLegacy.js';
import type { SearchContext, SearchListMode, SearchRequest, TrendingPeriod, TrendingScope } from './search/searchShared.js';
import { handleListMode } from './search/searchListModes.js';

export const searchMemes = async (req: SearchRequest, res: Response) => {
  const query = (req.query ?? {}) as Record<string, unknown>;
  const {
    q,
    tags,
    channelId,
    channelSlug,
    minPrice,
    maxPrice,
    sortBy = 'createdAt',
    sortOrder = 'desc',
    includeUploader,
    favorites,
    listMode,
    trendingScope,
    trendingPeriod,
    limit = 50,
    offset = 0,
  } = query;

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

  const targetChannel = targetChannelId
    ? await prisma.channel.findUnique({
        where: { id: targetChannelId },
        select: {
          id: true,
          memeCatalogMode: true,
          defaultPriceCoins: true,
          slug: true,
          dynamicPricingEnabled: true,
          dynamicPricingMinMult: true,
          dynamicPricingMaxMult: true,
        },
      })
    : null;
  const memeCatalogMode = String(targetChannel?.memeCatalogMode || 'channel');

  const listModeRaw = String(listMode || '').trim().toLowerCase();
  const normalizedListMode: SearchListMode | null =
    listModeRaw === 'favorites' ||
    listModeRaw === 'frequent' ||
    listModeRaw === 'recent' ||
    listModeRaw === 'hidden' ||
    listModeRaw === 'trending' ||
    listModeRaw === 'blocked'
      ? (listModeRaw as SearchListMode)
      : null;
  const legacyFavorites = String(favorites || '') === '1' && !!req.userId && !!targetChannelId;
  const effectiveListMode = normalizedListMode ?? (legacyFavorites ? 'frequent' : null);
  const favoritesEnabled = effectiveListMode === 'frequent';

  const scopeRaw = String(trendingScope || '').trim().toLowerCase();
  const normalizedScope: TrendingScope = scopeRaw === 'global' ? 'global' : 'channel';
  const periodRaw = parseInt(String(trendingPeriod || ''), 10);
  const normalizedPeriod: TrendingPeriod = periodRaw === 7 ? 7 : 30;

  const parsedLimitRaw = parseInt(limit as string, 10);
  const parsedOffsetRaw = parseInt(offset as string, 10);
  const maxSearchFromEnv = parseInt(String(process.env.SEARCH_PAGE_MAX || ''), 10);
  const MAX_SEARCH_PAGE = Number.isFinite(maxSearchFromEnv) && maxSearchFromEnv > 0 ? maxSearchFromEnv : 50;
  const parsedLimit = clampInt(parsedLimitRaw, 1, MAX_SEARCH_PAGE, 50);
  const parsedOffset = clampInt(parsedOffsetRaw, 0, 1_000_000, 0);

  const hasUser = !!req.userId;
  const personalized = favoritesEnabled || !!effectiveListMode || hasUser;

  if (personalized) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else {
    setSearchCacheHeaders(req as AuthRequest, res);
    const qStr = q ? String(q).trim().slice(0, 100) : '';
    const tagsKey = parseTagNames(tags).join(',');
    const cacheKey = [
      'v1',
      targetChannelId ?? '',
      qStr.toLowerCase(),
      tagsKey,
      String(minPrice ?? ''),
      String(maxPrice ?? ''),
      String(sortBy ?? ''),
      String(sortOrder ?? ''),
      String(includeUploader ?? ''),
      String(parsedLimit),
      String(parsedOffset),
    ].join('|');

    const ttl = getSearchCacheMs();
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < ttl) {
      res.setHeader('ETag', cached.etag);
      if (ifNoneMatchHit(req as AuthRequest, cached.etag)) return res.status(304).end();
      return res.type('application/json').send(cached.body);
    }

    try {
      const rkey = nsKey('search', cacheKey);
      const body = await redisGetString(rkey);
      if (body) {
        const etag = makeEtagFromString(body);
        res.setHeader('ETag', etag);
        if (ifNoneMatchHit(req as AuthRequest, etag)) return res.status(304).end();
        searchCache.set(cacheKey, { ts: Date.now(), body, etag });
        if (searchCache.size > SEARCH_CACHE_MAX) searchCache.clear();
        return res.type('application/json').send(body);
      }
    } catch {
      // ignore
    }
    req.__searchCacheKey = cacheKey;
  }

  const qStr = q ? String(q).trim() : '';
  const tagsStr = tags ? String(tags).trim() : '';
  const includeUploaderEnabled = String(includeUploader || '') === '1';
  const sortByStr = String(sortBy || 'createdAt');
  const sortOrderStr = String(sortOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

  const ctx: SearchContext = {
    req,
    res,
    targetChannelId,
    targetChannel: targetChannel
      ? {
          id: targetChannel.id,
          memeCatalogMode: targetChannel.memeCatalogMode ?? null,
          defaultPriceCoins: targetChannel.defaultPriceCoins ?? null,
          slug: targetChannel.slug ?? null,
          dynamicPricingEnabled: targetChannel.dynamicPricingEnabled ?? null,
          dynamicPricingMinMult: targetChannel.dynamicPricingMinMult ?? null,
          dynamicPricingMaxMult: targetChannel.dynamicPricingMaxMult ?? null,
        }
      : null,
    memeCatalogMode,
    minPrice,
    maxPrice,
    qStr,
    tagsStr,
    includeUploaderEnabled,
    favoritesEnabled,
    listMode: effectiveListMode,
    trendingScope: normalizedScope,
    trendingPeriod: normalizedPeriod,
    sortByStr,
    sortOrderStr,
    parsedLimit,
    parsedOffset,
  };

  const listModeResponse = await handleListMode(ctx);
  if (listModeResponse) return listModeResponse;

  const listing = await handleChannelListingMode(ctx);
  if (listing) return listing;

  const poolFilter = await handlePoolAllChannelFilterMode(ctx);
  if (poolFilter) return poolFilter;

  const channelSearch = await handleChannelSearchMode(ctx);
  if (channelSearch) return channelSearch;

  return await handleLegacySearch(ctx, query);
};
