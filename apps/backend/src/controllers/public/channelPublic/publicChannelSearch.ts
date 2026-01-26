import type { AuthRequest } from '../../../middleware/auth.js';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
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
import { parseQueryBool } from '../../../shared/utils/queryParsers.js';
import { buildSearchTerms } from '../../../shared/utils/searchTerms.js';
import { loadLegacyTagsById } from '../../viewer/channelMemeListDto.js';
import { parseTagNames } from '../../viewer/cache.js';
import { applyViewerMemeState, buildChannelMemeVisibilityFilter, buildMemeAssetVisibilityFilter, loadViewerMemeState } from '../../viewer/memeViewerState.js';
import {
  applyDynamicPricingToItems,
  collectChannelMemeIds,
  loadDynamicPricingSnapshot,
  normalizeDynamicPricingSettings,
} from '../../../services/meme/dynamicPricing.js';

export const searchPublicChannelMemes = async (req: AuthRequest, res: Response) => {
  const query = req.query as PublicChannelSearchQuery;
  const slug = String(req.params.slug || '').trim();
  const q = String(query.q || '')
    .trim()
    .slice(0, 100);
  const tagsStr = String(query.tags || '').trim();
  const tagNames = parseTagNames(tagsStr);

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
  const queryMode = Prisma.QueryMode.insensitive;
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
    where: { slug: { equals: slug, mode: queryMode } },
    select: {
      id: true,
      memeCatalogMode: true,
      defaultPriceCoins: true,
      dynamicPricingEnabled: true,
      dynamicPricingMinMult: true,
      dynamicPricingMaxMult: true,
    },
  });
  if (!channel)
    return res
      .status(404)
      .json({ errorCode: 'CHANNEL_NOT_FOUND', error: 'Channel not found', details: { entity: 'channel', slug } });

  const memeCatalogMode = channel.memeCatalogMode ?? 'channel';
  const defaultPriceCoins = Number.isFinite(channel.defaultPriceCoins ?? NaN) ? (channel.defaultPriceCoins ?? 0) : 100;
  const poolWhereBase = buildChannelPoolWhere(channel.id);
  const poolVisibility = buildMemeAssetVisibilityFilter({
    channelId: channel.id,
    userId: req.userId ?? null,
    includeUserHidden: true,
  });
  if (poolVisibility) Object.assign(poolWhereBase, poolVisibility);
  if (tagNames.length > 0) {
    poolWhereBase.AND = tagNames.map((tag: string) => ({ aiSearchText: { contains: tag, mode: queryMode } }));
  }
  if (q) {
    const terms = buildSearchTerms(q);
    const searchTerms = terms.length > 0 ? terms : [q];
    poolWhereBase.OR = searchTerms.flatMap((term) => [
      { aiAutoTitle: { contains: term, mode: queryMode } },
      { aiSearchText: { contains: term, mode: queryMode } },
      { channelMemes: { some: { title: { contains: term, mode: queryMode } } } },
    ]);
    poolWhereBase.OR.push({ createdBy: { displayName: { contains: q, mode: queryMode } } });
  }

  const channelWhereBase = buildChannelMemeWhere(channel.id);
  const channelVisibility = buildChannelMemeVisibilityFilter({
    channelId: channel.id,
    userId: req.userId ?? null,
    includeUserHidden: true,
  });
  if (channelVisibility) {
    if (!channelWhereBase.AND) channelWhereBase.AND = [channelVisibility];
    else if (Array.isArray(channelWhereBase.AND)) channelWhereBase.AND.push(channelVisibility);
    else channelWhereBase.AND = [channelWhereBase.AND, channelVisibility];
  }
  if (tagNames.length > 0) {
    const tagFilters = tagNames.map((tag: string) => ({
      tags: { some: { tag: { name: { contains: tag, mode: queryMode } } } },
    }));
    if (!channelWhereBase.AND) channelWhereBase.AND = tagFilters;
    else if (Array.isArray(channelWhereBase.AND)) channelWhereBase.AND.push(...tagFilters);
    else channelWhereBase.AND = [channelWhereBase.AND, ...tagFilters];
  }
  if (q) {
    const terms = buildSearchTerms(q);
    const searchTerms = terms.length > 0 ? terms : [q];
    channelWhereBase.OR = searchTerms.flatMap((term) => [
      { title: { contains: term, mode: queryMode } },
      { memeAsset: { aiAutoTitle: { contains: term, mode: queryMode } } },
      { memeAsset: { aiSearchText: { contains: term, mode: queryMode } } },
    ]);
    channelWhereBase.OR.push({ memeAsset: { createdBy: { displayName: { contains: q, mode: queryMode } } } });
  }

  if (!useCursorMode) {
    const attachViewerState = async (items: PublicChannelMemeListItem[]) => {
      const memeAssetIds = items
        .map((item) => (typeof item.memeAssetId === 'string' ? item.memeAssetId : typeof item.id === 'string' ? item.id : ''))
        .filter((id) => id && id.length > 0);
      const state = await loadViewerMemeState({
        userId: req.userId ?? null,
        channelId: channel.id,
        memeAssetIds,
      });
      return applyViewerMemeState(items, state) as PublicChannelMemeListItem[];
    };

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
          qualityScore: true,
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
          aiAutoTagNames: true,
          createdBy: { select: { id: true, displayName: true } },
          channelMemes: {
            where: { channelId: channel.id, status: 'approved', deletedAt: null },
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              title: true,
              priceCoins: true,
              cooldownMinutes: true,
              lastActivatedAt: true,
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
      const legacyTagsById = await loadLegacyTagsById(rows.map((row) => row.channelMemes?.[0]?.id ?? null));
      items = mapPoolAssetsToDtos(rows, channel.id, defaultPriceCoins).map((item, idx) => {
        const channelMemeId = rows[idx]?.channelMemes?.[0]?.id ?? '';
        const tags = legacyTagsById.get(channelMemeId);
        return tags && tags.length > 0 ? { ...item, tags } : item;
      });
      items = await attachViewerState(items);
    } else {
      const rows = await prisma.channelMeme.findMany({
        where: channelWhereBase,
        orderBy: orderings.channelMeme,
        take: limit,
        skip: offset,
        select: {
          id: true,
          memeAssetId: true,
          title: true,
          priceCoins: true,
          cooldownMinutes: true,
          lastActivatedAt: true,
          status: true,
          createdAt: true,
          memeAsset: {
            select: {
              type: true,
              fileUrl: true,
              durationMs: true,
              qualityScore: true,
              aiAutoTagNames: true,
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
      const legacyTagsById = await loadLegacyTagsById(rows.map((row) => row.id));
      items = rows.map((row) => {
        const item = toPublicChannelMemeListItemDto(channel.id, row);
        const tags = legacyTagsById.get(row.id);
        return tags && tags.length > 0 ? { ...item, tags } : item;
      });
      items = await attachViewerState(items);
    }

    if (items.length > 0) {
      const dynamicSettings = normalizeDynamicPricingSettings(channel);
      const snapshot = await loadDynamicPricingSnapshot({
        channelId: channel.id,
        channelMemeIds: collectChannelMemeIds(items as Array<Record<string, unknown>>),
        settings: dynamicSettings,
      });
      items = applyDynamicPricingToItems(
        items as Array<Record<string, unknown>>,
        snapshot,
      ) as PublicChannelMemeListItem[];
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

  const includeTotal = parseQueryBool(req.query.includeTotal);
  let hasMore = false;
  let items: PublicChannelMemeListItem[] = [];
  let total: number | null = null;

  const attachViewerState = async (items: PublicChannelMemeListItem[]) => {
    const memeAssetIds = items
      .map((item) => (typeof item.memeAssetId === 'string' ? item.memeAssetId : typeof item.id === 'string' ? item.id : ''))
      .filter((id) => id && id.length > 0);
    const state = await loadViewerMemeState({
      userId: req.userId ?? null,
      channelId: channel.id,
      memeAssetIds,
    });
    return applyViewerMemeState(items, state) as PublicChannelMemeListItem[];
  };

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
        qualityScore: true,
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
        aiAutoTagNames: true,
        createdBy: { select: { id: true, displayName: true } },
        channelMemes: {
          where: { channelId: channel.id, status: 'approved', deletedAt: null },
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            title: true,
            priceCoins: true,
            cooldownMinutes: true,
            lastActivatedAt: true,
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
    const legacyTagsById = await loadLegacyTagsById(sliced.map((row) => row.channelMemes?.[0]?.id ?? null));
    items = mapPoolAssetsToDtos(sliced, channel.id, defaultPriceCoins).map((item, idx) => {
      const channelMemeId = sliced[idx]?.channelMemes?.[0]?.id ?? '';
      const tags = legacyTagsById.get(channelMemeId);
      return tags && tags.length > 0 ? { ...item, tags } : item;
    });
    items = await attachViewerState(items);
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
        memeAssetId: true,
        title: true,
        priceCoins: true,
        cooldownMinutes: true,
        lastActivatedAt: true,
        status: true,
        createdAt: true,
        memeAsset: {
          select: {
            type: true,
            fileUrl: true,
            durationMs: true,
            qualityScore: true,
            aiAutoTagNames: true,
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
    const legacyTagsById = await loadLegacyTagsById(sliced.map((row) => row.id));
    items = sliced.map((row) => {
      const item = toPublicChannelMemeListItemDto(channel.id, row);
      const tags = legacyTagsById.get(row.id);
      return tags && tags.length > 0 ? { ...item, tags } : item;
    });
    items = await attachViewerState(items);
    if (includeTotal) {
      total = await prisma.channelMeme.count({
        where: channelWhereBase,
      });
    }
  }

  if (items.length > 0) {
    const dynamicSettings = normalizeDynamicPricingSettings(channel);
    const snapshot = await loadDynamicPricingSnapshot({
      channelId: channel.id,
      channelMemeIds: collectChannelMemeIds(items as Array<Record<string, unknown>>),
      settings: dynamicSettings,
    });
    items = applyDynamicPricingToItems(
      items as Array<Record<string, unknown>>,
      snapshot,
    ) as PublicChannelMemeListItem[];
  }

  const nextCursor = hasMore && items.length > 0 ? encodeCursorFromItem(items[items.length - 1], cursorSchema) : null;
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
