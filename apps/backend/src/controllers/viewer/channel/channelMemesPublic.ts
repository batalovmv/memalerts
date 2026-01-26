import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import type { AuthRequest } from '../../../middleware/auth.js';
import { prisma } from '../../../lib/prisma.js';
import {
  buildCooldownPayload,
  getSourceType,
  loadLegacyTagsById,
  toChannelMemeListItemDto,
  type ChannelMemeListItemDto,
} from '../channelMemeListDto.js';
import { applyViewerMemeState, buildChannelMemeVisibilityFilter, buildMemeAssetVisibilityFilter, loadViewerMemeState } from '../memeViewerState.js';
import {
  applyDynamicPricingToItems,
  collectChannelMemeIds,
  loadDynamicPricingSnapshot,
  normalizeDynamicPricingSettings,
} from '../../../services/meme/dynamicPricing.js';
import {
  PaginationError,
  buildCursorFilter,
  encodeCursorFromItem,
  mergeCursorWhere,
  parseLimit,
  safeDecodeCursor,
} from '../../../utils/pagination.js';
import { ifNoneMatchHit, makeEtagFromString } from '../cache.js';
import { makeCreatedCursorSchema, makePriceCursorSchema } from './shared.js';
import type { ChannelMemeRow, PoolAssetRow } from './shared.js';

export const getChannelMemesPublic = async (req: AuthRequest, res: Response) => {
  const slug = String(req.params.slug || '').trim();

  const maxFromEnv = parseInt(String(process.env.CHANNEL_MEMES_PAGE_MAX || ''), 10);
  const envMax = Number.isFinite(maxFromEnv) && maxFromEnv > 0 ? maxFromEnv : 50;
  const MAX_PAGE = Math.min(envMax, 100);
  const defaultLimit = Math.min(50, MAX_PAGE);
  let limit = defaultLimit;
  try {
    limit = parseLimit(req.query.limit, { defaultLimit, maxLimit: MAX_PAGE });
  } catch (error: unknown) {
    if (error instanceof PaginationError) {
      return res.status(error.status).json({
        errorCode: error.errorCode,
        error: error.message,
        details: error.details,
      });
    }
    throw error;
  }
  const cursorRaw = req.query.cursor;
  let cursor: Record<string, unknown> | null = null;

  const sortByRaw = String(req.query.sortBy || '').trim();
  const sortOrderRaw = String(req.query.sortOrder || '')
    .trim()
    .toLowerCase();
  const sortBy = sortByRaw === 'priceCoins' ? 'priceCoins' : 'createdAt';
  const sortOrder = sortOrderRaw === 'asc' ? 'asc' : 'desc';

  if (req?.userId) res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  else res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');

  if (!slug) {
    return res.status(400).json({ errorCode: 'BAD_REQUEST', error: 'Bad request', details: { field: 'slug' } });
  }

  const channel = await prisma.channel.findFirst({
    where: { slug: { equals: slug, mode: 'insensitive' } },
    select: {
      id: true,
      slug: true,
      memeCatalogMode: true,
      defaultPriceCoins: true,
      dynamicPricingEnabled: true,
      dynamicPricingMinMult: true,
      dynamicPricingMaxMult: true,
    },
  });

  if (!channel) {
    return res
      .status(404)
      .json({ errorCode: 'CHANNEL_NOT_FOUND', error: 'Channel not found', details: { entity: 'channel', slug } });
  }

  const memeCatalogMode = String(channel.memeCatalogMode || 'channel');
  const isPoolMode = memeCatalogMode === 'pool_all';
  const priceSortEnabled = !isPoolMode && sortBy === 'priceCoins';
  const cursorSchema = priceSortEnabled ? makePriceCursorSchema(sortOrder) : makeCreatedCursorSchema(sortOrder);

  try {
    cursor = safeDecodeCursor(cursorRaw, cursorSchema);
  } catch (error: unknown) {
    if (error instanceof PaginationError) {
      return res.status(error.status).json({
        errorCode: error.errorCode,
        error: error.message,
        details: error.details,
      });
    }
    throw error;
  }

  let items: ChannelMemeListItemDto[] | Array<Record<string, unknown>> = [];
  let hasMore = false;

  const attachViewerState = async (items: Array<Record<string, unknown>>) => {
    const memeAssetIds = items
      .map((item) => (typeof item.memeAssetId === 'string' ? item.memeAssetId : typeof item.id === 'string' ? item.id : ''))
      .filter((id) => id && id.length > 0);
    const state = await loadViewerMemeState({
      userId: req.userId ?? null,
      channelId: channel.id,
      memeAssetIds,
    });
    return applyViewerMemeState(items, state);
  };

  if (isPoolMode) {
    const poolWhere: Prisma.MemeAssetWhereInput = {
      status: 'active',
      deletedAt: null,
      fileUrl: { not: '' },
      NOT: {
        channelMemes: {
          some: {
            channelId: channel.id,
            OR: [{ status: { not: 'approved' } }, { deletedAt: { not: null } }],
          },
        },
      },
    };

    const visibility = buildMemeAssetVisibilityFilter({
      channelId: channel.id,
      userId: req.userId ?? null,
      includeUserHidden: true,
    });
    if (visibility) Object.assign(poolWhere, visibility);

    const poolCursorFilter = cursor ? buildCursorFilter(cursorSchema, cursor) : null;
    const where = mergeCursorWhere(poolWhere, poolCursorFilter);
    const rows = await prisma.memeAsset.findMany({
      where,
      orderBy: [{ createdAt: sortOrder }, { id: 'desc' as const }],
      take: limit + 1,
      select: {
        id: true,
        type: true,
        fileUrl: true,
        fileHash: true,
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
        createdBy: { select: { id: true, displayName: true } },
        channelMemes: {
          where: { channelId: channel.id, status: 'approved', deletedAt: null },
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { id: true, title: true, priceCoins: true, cooldownMinutes: true, lastActivatedAt: true },
        },
      },
    });

    const defaultPriceCoins = Number.isFinite(channel.defaultPriceCoins) ? channel.defaultPriceCoins : 100;
    hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const legacyTagsById = await loadLegacyTagsById(
      (sliced as PoolAssetRow[]).flatMap((row) =>
        Array.isArray(row.channelMemes)
          ? row.channelMemes.map((ch) => ch?.id ?? null)
          : []
      )
    );
    items = (sliced as PoolAssetRow[]).map((r) => {
      const ch = Array.isArray(r.channelMemes) && r.channelMemes.length > 0 ? r.channelMemes[0] : null;
      const title = String(ch?.title || r.aiAutoTitle || 'Meme').slice(0, 200);
      const channelPrice = ch?.priceCoins;
      const priceCoins = Number.isFinite(channelPrice) ? (channelPrice as number) : defaultPriceCoins;
      const legacyTags = legacyTagsById.get(ch?.id ?? '');
      const cooldownPayload = buildCooldownPayload({
        cooldownMinutes: ch?.cooldownMinutes ?? null,
        lastActivatedAt: ch?.lastActivatedAt ?? null,
      });
      const doneVariants = Array.isArray(r.variants)
        ? r.variants.filter((v) => String(v.status || '') === 'done')
        : [];
      const preview = doneVariants.find((v) => String(v.format || '') === 'preview');
      const variants = doneVariants
        .filter((v) => String(v.format || '') !== 'preview')
        .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
        .map((v) => {
          const format = (String(v.format || '') as 'webm' | 'mp4') || 'mp4';
          return {
            format,
            fileUrl: v.fileUrl,
            sourceType: getSourceType(format),
            fileSizeBytes: typeof v.fileSizeBytes === 'bigint' ? Number(v.fileSizeBytes) : null,
          };
        });
      return {
        id: r.id,
        channelId: channel.id,
        channelMemeId: ch?.id ?? r.id,
        memeAssetId: r.id,
        title,
        type: r.type,
        previewUrl: preview?.fileUrl ?? null,
        variants,
        fileUrl: variants[0]?.fileUrl ?? preview?.fileUrl ?? r.fileUrl ?? null,
        durationMs: r.durationMs,
        priceCoins,
        ...(cooldownPayload ?? {}),
        status: 'approved',
        deletedAt: null,
        createdAt: r.createdAt,
        createdBy: r.createdBy ? { id: r.createdBy.id, displayName: r.createdBy.displayName } : null,
        fileHash: null,
        ...(legacyTags && legacyTags.length > 0 ? { tags: legacyTags } : {}),
      };
    });
    items = await attachViewerState(items as Array<Record<string, unknown>>);
    const dynamicSettings = normalizeDynamicPricingSettings(channel);
    const snapshot = await loadDynamicPricingSnapshot({
      channelId: channel.id,
      channelMemeIds: collectChannelMemeIds(items as Array<Record<string, unknown>>),
      settings: dynamicSettings,
    });
    items = applyDynamicPricingToItems(items as Array<Record<string, unknown>>, snapshot);
  } else {
    const baseWhere = {
      channelId: channel.id,
      status: 'approved',
      deletedAt: null,
    };
    const visibility = buildChannelMemeVisibilityFilter({
      channelId: channel.id,
      userId: req.userId ?? null,
      includeUserHidden: true,
    });
    if (visibility) {
      const current = baseWhere as Prisma.ChannelMemeWhereInput;
      if (!current.AND) current.AND = [visibility];
      else if (Array.isArray(current.AND)) current.AND.push(visibility);
      else current.AND = [current.AND, visibility];
    }
    const cursorFilter = cursor ? buildCursorFilter(cursorSchema, cursor) : null;
    const where = mergeCursorWhere(baseWhere, cursorFilter);
    const orderBy = priceSortEnabled
      ? [{ priceCoins: sortOrder }, { createdAt: 'desc' as const }, { id: 'desc' as const }]
      : [{ createdAt: sortOrder }, { id: 'desc' as const }];
    const rows = await prisma.channelMeme.findMany({
      where,
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
            fileHash: true,
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
            aiStatus: true,
            aiAutoTitle: true,
            aiAutoDescription: true,
            aiAutoTagNames: true,
            createdBy: { select: { id: true, displayName: true } },
          },
        },
      },
      orderBy: orderBy as Prisma.ChannelMemeOrderByWithRelationInput[],
      take: limit + 1,
    });

    hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const legacyTagsById = await loadLegacyTagsById(sliced.map((r) => r.id));
    items = (sliced as ChannelMemeRow[]).map((r) => {
      const item = toChannelMemeListItemDto(req, channel.id, r);
      const tags = legacyTagsById.get(r.id);
      return tags && tags.length > 0 ? { ...item, tags } : item;
    });
    items = await attachViewerState(items as Array<Record<string, unknown>>);
    const dynamicSettings = normalizeDynamicPricingSettings(channel);
    const snapshot = await loadDynamicPricingSnapshot({
      channelId: channel.id,
      channelMemeIds: collectChannelMemeIds(items as Array<Record<string, unknown>>),
      settings: dynamicSettings,
    });
    items = applyDynamicPricingToItems(items as Array<Record<string, unknown>>, snapshot);
  }

  const nextCursor = hasMore && items.length > 0 ? encodeCursorFromItem(items[items.length - 1], cursorSchema) : null;
  const payload = { items, nextCursor };

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
