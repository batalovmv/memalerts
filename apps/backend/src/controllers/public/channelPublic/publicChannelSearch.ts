import type { AuthRequest } from '../../../middleware/auth.js';
import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { toPublicChannelMemeListItemDto } from '../dto/publicChannelMemeListItemDto.js';
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
  type PublicChannelMemeListItem,
  type PublicChannelSearchQuery,
} from './shared.js';
import {
  PaginationError,
  buildCursorFilter,
  encodeCursorFromItem,
  mergeCursorWhere,
  parseLimit,
} from '../../../utils/pagination.js';
import { ifNoneMatchHit, makeEtagFromString } from '../../viewer/cache.js';

export const searchPublicChannelMemes = async (req: AuthRequest, res: Response) => {
  const query = req.query as PublicChannelSearchQuery;
  const slug = String(req.params.slug || '').trim();
  const q = String(query.q || '')
    .trim()
    .slice(0, 100);

  const maxFromEnv = parseInt(String(process.env.SEARCH_PAGE_MAX || ''), 10);
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

  if (req.userId) res.setHeader('Cache-Control', 'private, max-age=20, stale-while-revalidate=40');
  else res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');

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
  const defaultPriceCoins = Number.isFinite(channel.defaultPriceCoins ?? NaN)
    ? channel.defaultPriceCoins ?? 0
    : 100;
  const poolWhereBase = buildChannelPoolWhere(channel.id);
  if (q) {
    poolWhereBase.OR = [
      { aiAutoTitle: { contains: q, mode: 'insensitive' } },
      { aiSearchText: { contains: q, mode: 'insensitive' } },
      { channelMemes: { some: { title: { contains: q, mode: 'insensitive' } } } },
      { createdBy: { displayName: { contains: q, mode: 'insensitive' } } },
    ];
  }

  const channelWhereBase = buildChannelMemeWhere(channel.id);
  if (q) {
    channelWhereBase.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { searchText: { contains: q, mode: 'insensitive' } },
      { memeAsset: { createdBy: { displayName: { contains: q, mode: 'insensitive' } } } },
    ];
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
          createdAt: true,
          aiAutoTitle: true,
          createdBy: { select: { id: true, displayName: true } },
          channelMemes: {
            where: { channelId: channel.id, status: 'approved', deletedAt: null },
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: { title: true, priceCoins: true },
          },
        },
      });
      items = mapPoolAssetsToDtos(rows, channel.id, defaultPriceCoins);
    } else {
      const rows = await prisma.channelMeme.findMany({
        where: channelWhereBase,
        orderBy: orderings.channelMeme,
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
      items = rows.map((row) => toPublicChannelMemeListItemDto(channel.id, row));
    }

    try {
      const body = JSON.stringify(items);
      const etag = makeEtagFromString(body);
      res.setHeader('ETag', etag);
      if (ifNoneMatchHit(req, etag)) return res.status(304).end();
      return res.type('application/json').send(body);
    } catch {
      return res.json(items);
    }
  }

  const includeTotalRaw = String(req.query.includeTotal || '')
    .trim()
    .toLowerCase();
  const includeTotal = includeTotalRaw === '1' || includeTotalRaw === 'true';
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
        createdAt: true,
        aiAutoTitle: true,
        createdBy: { select: { id: true, displayName: true } },
        channelMemes: {
          where: { channelId: channel.id, status: 'approved', deletedAt: null },
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { title: true, priceCoins: true },
        },
      },
    });
    hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    items = mapPoolAssetsToDtos(sliced, channel.id, defaultPriceCoins);
    if (includeTotal) total = await prisma.memeAsset.count({ where: poolWhereBase });
  } else {
    const cursorFilter = cursor ? buildCursorFilter(cursorSchema, cursor) : null;
    const where = mergeCursorWhere(channelWhereBase, cursorFilter);
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
    hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    items = sliced.map((row) => toPublicChannelMemeListItemDto(channel.id, row));
    if (includeTotal) {
      total = await prisma.channelMeme.count({
        where: channelWhereBase,
      });
    }
  }

  const nextCursor =
    hasMore && items.length > 0 ? encodeCursorFromItem(items[items.length - 1], cursorSchema) : null;
  const payload = { items, nextCursor, total };

  try {
    const body = JSON.stringify(payload);
    const etag = makeEtagFromString(body);
    res.setHeader('ETag', etag);
    if (ifNoneMatchHit(req, etag)) return res.status(304).end();
    return res.type('application/json').send(body);
  } catch {
    return res.json(payload);
  }
};
