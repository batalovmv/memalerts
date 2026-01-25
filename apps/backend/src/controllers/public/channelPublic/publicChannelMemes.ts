import type { AuthRequest } from '../../../middleware/auth.js';
import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { toPublicChannelMemeListItemDto } from '../dto/publicChannelMemeListItemDto.js';
import { loadLegacyTagsById } from '../../viewer/channelMemeListDto.js';
import {
  buildChannelMemeWhere,
  buildChannelPoolWhere,
  buildCursorSchemaForSort,
  buildListOrderings,
  decodeCursorParam,
  LEGACY_DEFAULT_LIMIT,
  mapPoolAssetsToDtos,
  parseLegacyOffset,
  respondPaginationError,
  shouldUseCursorMode,
  type CursorDictionary,
  type PublicChannelMemesQuery,
  type PublicChannelMemeListItem,
} from './shared.js';
import {
  PaginationError,
  buildCursorFilter,
  encodeCursorFromItem,
  mergeCursorWhere,
  parseLimit,
} from '../../../utils/pagination.js';
import {
  getSearchCacheMs,
  ifNoneMatchHit,
  makeEtagFromString,
  pruneOldestEntries,
  searchCache,
  SEARCH_CACHE_MAX,
} from '../../viewer/cache.js';
import { nsKey, redisGetString, redisSetStringEx } from '../../../utils/redisCache.js';
import { parseQueryBool } from '../../../shared/utils/queryParsers.js';

export const getPublicChannelMemes = async (req: AuthRequest, res: Response) => {
  const query = req.query as PublicChannelMemesQuery;
  const slug = String(req.params.slug || '').trim();

  const maxFromEnv = parseInt(String(process.env.CHANNEL_MEMES_PAGE_MAX || ''), 10);
  const MAX_PAGE = Number.isFinite(maxFromEnv) && maxFromEnv > 0 ? maxFromEnv : 50;
  let limit = LEGACY_DEFAULT_LIMIT;
  try {
    limit = parseLimit(query.limit, { defaultLimit: LEGACY_DEFAULT_LIMIT, maxLimit: MAX_PAGE });
  } catch (error: unknown) {
    if (error instanceof PaginationError) return respondPaginationError(res, error);
    throw error;
  }
  const offset = parseLegacyOffset(query.offset);

  const sortByRaw = String(query.sortBy || '').trim();
  const sortOrderRaw = String(query.sortOrder || '')
    .trim()
    .toLowerCase();
  const sortBy = sortByRaw === 'priceCoins' ? 'priceCoins' : 'createdAt';
  const sortOrder: Prisma.SortOrder = sortOrderRaw === 'asc' ? 'asc' : 'desc';
  const orderings = buildListOrderings(sortBy, sortOrder);
  const cursorSchema = buildCursorSchemaForSort(sortBy, sortOrder);
  const useCursorMode = shouldUseCursorMode(req);
  let cursor: CursorDictionary | null = null;
  if (useCursorMode) {
    try {
      cursor = decodeCursorParam(query.cursor, cursorSchema);
    } catch (error: unknown) {
      if (error instanceof PaginationError) return respondPaginationError(res, error);
      throw error;
    }
  }

  if (req.userId) res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  else res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');

  if (!slug)
    return res.status(400).json({ errorCode: 'BAD_REQUEST', error: 'Bad request', details: { field: 'slug' } });

  const channel = await prisma.channel.findFirst({
    where: { slug: { equals: slug, mode: 'insensitive' } },
    select: { id: true, memeCatalogMode: true, defaultPriceCoins: true },
  });
  if (!channel)
    return res
      .status(404)
      .json({ errorCode: 'CHANNEL_NOT_FOUND', error: 'Channel not found', details: { entity: 'channel', slug } });

  const memeCatalogMode = channel.memeCatalogMode ?? 'channel';
  const defaultPriceCoins = Number.isFinite(channel.defaultPriceCoins ?? NaN) ? (channel.defaultPriceCoins ?? 0) : 100;
  const poolWhereBase = buildChannelPoolWhere(channel.id);
  const includeTotal = parseQueryBool(query.includeTotal);
  const cacheTtl = getSearchCacheMs();
  const cacheKey = [
    'public_channel_memes',
    channel.id,
    memeCatalogMode,
    String(limit),
    String(offset),
    sortBy,
    sortOrder,
    useCursorMode ? 'cursor' : 'offset',
    String(query.cursor || ''),
    includeTotal ? 'total' : 'no_total',
  ].join('|');

  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < cacheTtl) {
    res.setHeader('ETag', cached.etag);
    if (ifNoneMatchHit(req, cached.etag)) return res.status(304).end();
    return res.type('application/json').send(cached.body);
  }

  const redisKey = nsKey('public_channel_memes', cacheKey);
  const redisCached = await redisGetString(redisKey);
  if (redisCached) {
    const etag = makeEtagFromString(redisCached);
    res.setHeader('ETag', etag);
    if (ifNoneMatchHit(req, etag)) return res.status(304).end();
    searchCache.set(cacheKey, { ts: Date.now(), body: redisCached, etag });
    pruneOldestEntries(searchCache, SEARCH_CACHE_MAX);
    return res.type('application/json').send(redisCached);
  }

  if (!useCursorMode) {
    let items: PublicChannelMemeListItem[] = [];
    if (memeCatalogMode === 'pool_all') {
      const rows = await prisma.memeAsset.findMany({
        where: poolWhereBase,
        orderBy: orderings.memeAsset,
        take: limit,
        skip: offset,
        select: {
          id: true,
          type: true,
          fileUrl: true,
          durationMs: true,
          variants: {
            select: {
              format: true,
              fileUrl: true,
              status: true,
              priority: true,
              fileSizeBytes: true,
            },
          },
          createdAt: true,
          aiAutoTitle: true,
          aiAutoTagNamesJson: true,
          createdBy: { select: { id: true, displayName: true } },
          channelMemes: {
            where: { channelId: channel.id, status: 'approved', deletedAt: null },
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: {
              title: true,
              priceCoins: true,
              legacyMemeId: true,
              _count: {
                select: {
                  activations: {
                    where: { status: 'done' },
                  },
                },
              },
            },
          },
        },
      });
      const legacyTagsById = await loadLegacyTagsById(rows.map((row) => row.channelMemes?.[0]?.legacyMemeId ?? null));
      items = mapPoolAssetsToDtos(rows, channel.id, defaultPriceCoins).map((item, idx) => {
        const legacyId = rows[idx]?.channelMemes?.[0]?.legacyMemeId ?? '';
        const tags = legacyTagsById.get(legacyId);
        return tags && tags.length > 0 ? { ...item, tags } : item;
      });
    } else {
      const rows = await prisma.channelMeme.findMany({
        where: buildChannelMemeWhere(channel.id),
        orderBy: orderings.channelMeme,
        take: limit,
        skip: offset,
        select: {
          id: true,
          legacyMemeId: true,
          memeAssetId: true,
          title: true,
          priceCoins: true,
          aiAutoTagNamesJson: true,
          status: true,
          createdAt: true,
          memeAsset: {
            select: {
              type: true,
              fileUrl: true,
              durationMs: true,
              variants: {
                select: {
                  format: true,
                  fileUrl: true,
                  status: true,
                  priority: true,
                  fileSizeBytes: true,
                },
              },
              createdBy: { select: { id: true, displayName: true } },
            },
          },
          _count: {
            select: {
              activations: {
                where: { status: 'done' },
              },
            },
          },
        },
      });
      const legacyTagsById = await loadLegacyTagsById(rows.map((row) => row.legacyMemeId));
      items = rows.map((row) => {
        const item = toPublicChannelMemeListItemDto(channel.id, row);
        const tags = legacyTagsById.get(row.legacyMemeId ?? '');
        return tags && tags.length > 0 ? { ...item, tags } : item;
      });
    }

    try {
      const body = JSON.stringify(items);
      const etag = makeEtagFromString(body);
      res.setHeader('ETag', etag);
      if (ifNoneMatchHit(req, etag)) return res.status(304).end();
      searchCache.set(cacheKey, { ts: Date.now(), body, etag });
      pruneOldestEntries(searchCache, SEARCH_CACHE_MAX);
      void redisSetStringEx(redisKey, Math.ceil(cacheTtl / 1000), body);
      return res.type('application/json').send(body);
    } catch {
      return res.json(items);
    }
  }

  let hasMore = false;
  let items: PublicChannelMemeListItem[] = [];
  let total: number | null = null;

  if (memeCatalogMode === 'pool_all') {
    const cursorFilter = cursor ? buildCursorFilter(cursorSchema, cursor) : null;
    const where = mergeCursorWhere(poolWhereBase, cursorFilter);
    const rows = await prisma.memeAsset.findMany({
      where,
      orderBy: orderings.memeAsset,
      take: limit + 1,
      select: {
        id: true,
        type: true,
        fileUrl: true,
        durationMs: true,
        variants: {
          select: {
            format: true,
            fileUrl: true,
            status: true,
            priority: true,
            fileSizeBytes: true,
          },
        },
        createdAt: true,
        aiAutoTitle: true,
        aiAutoTagNamesJson: true,
        createdBy: { select: { id: true, displayName: true } },
        channelMemes: {
          where: { channelId: channel.id, status: 'approved', deletedAt: null },
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            title: true,
            priceCoins: true,
            legacyMemeId: true,
            _count: {
              select: {
                activations: {
                  where: { status: 'done' },
                },
              },
            },
          },
        },
      },
    });
    hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const legacyTagsById = await loadLegacyTagsById(
      sliced.map((row) => row.channelMemes?.[0]?.legacyMemeId ?? null)
    );
    items = mapPoolAssetsToDtos(sliced, channel.id, defaultPriceCoins).map((item, idx) => {
      const legacyId = sliced[idx]?.channelMemes?.[0]?.legacyMemeId ?? '';
      const tags = legacyTagsById.get(legacyId);
      return tags && tags.length > 0 ? { ...item, tags } : item;
    });
    if (includeTotal) total = await prisma.memeAsset.count({ where: poolWhereBase });
  } else {
    const cursorFilter = cursor ? buildCursorFilter(cursorSchema, cursor) : null;
    const where = mergeCursorWhere(buildChannelMemeWhere(channel.id), cursorFilter);
    const rows = await prisma.channelMeme.findMany({
      where,
      orderBy: orderings.channelMeme,
      take: limit + 1,
      select: {
        id: true,
        legacyMemeId: true,
        memeAssetId: true,
        title: true,
        priceCoins: true,
        aiAutoTagNamesJson: true,
        status: true,
        createdAt: true,
        memeAsset: {
          select: {
            type: true,
            fileUrl: true,
            durationMs: true,
            variants: {
              select: {
                format: true,
                fileUrl: true,
                status: true,
                priority: true,
                fileSizeBytes: true,
              },
            },
            createdBy: { select: { id: true, displayName: true } },
          },
        },
        _count: {
          select: {
            activations: {
              where: { status: 'done' },
            },
          },
        },
      },
    });
    hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const legacyTagsById = await loadLegacyTagsById(sliced.map((row) => row.legacyMemeId));
    items = sliced.map((row) => {
      const item = toPublicChannelMemeListItemDto(channel.id, row);
      const tags = legacyTagsById.get(row.legacyMemeId ?? '');
      return tags && tags.length > 0 ? { ...item, tags } : item;
    });
    if (includeTotal) {
      total = await prisma.channelMeme.count({
        where: buildChannelMemeWhere(channel.id),
      });
    }
  }

  const nextCursor = hasMore && items.length > 0 ? encodeCursorFromItem(items[items.length - 1], cursorSchema) : null;
  const payload = { items, nextCursor, total };

  try {
    const body = JSON.stringify(payload);
    const etag = makeEtagFromString(body);
    res.setHeader('ETag', etag);
    if (ifNoneMatchHit(req, etag)) return res.status(304).end();
    searchCache.set(cacheKey, { ts: Date.now(), body, etag });
    pruneOldestEntries(searchCache, SEARCH_CACHE_MAX);
    void redisSetStringEx(redisKey, Math.ceil(cacheTtl / 1000), body);
    return res.type('application/json').send(body);
  } catch {
    return res.json(payload);
  }
};
