import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import type { AuthRequest } from '../../../middleware/auth.js';
import { prisma } from '../../../lib/prisma.js';
import { toChannelMemeListItemDto, type ChannelMemeListItemDto } from '../channelMemeListDto.js';
import {
  PaginationError,
  buildCursorFilter,
  encodeCursorFromItem,
  mergeCursorWhere,
  parseLimit,
  safeDecodeCursor,
} from '../../../utils/pagination.js';
import { ifNoneMatchHit, makeEtagFromString } from '../cache.js';
import { ChannelMemeRow, PoolAssetRow, makeCreatedCursorSchema, makePriceCursorSchema } from './shared.js';

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
    select: { id: true, slug: true, memeCatalogMode: true, defaultPriceCoins: true },
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

  if (isPoolMode) {
    const poolWhere: Prisma.MemeAssetWhereInput = {
      poolVisibility: 'visible',
      purgedAt: null,
      fileUrl: { not: null },
      NOT: {
        channelMemes: {
          some: {
            channelId: channel.id,
            OR: [{ status: { not: 'approved' } }, { deletedAt: { not: null } }],
          },
        },
      },
    };

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

    const defaultPriceCoins = Number.isFinite(channel.defaultPriceCoins) ? channel.defaultPriceCoins : 100;
    hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    items = (sliced as PoolAssetRow[]).map((r) => {
      const ch = Array.isArray(r.channelMemes) && r.channelMemes.length > 0 ? r.channelMemes[0] : null;
      const title = String(ch?.title || r.aiAutoTitle || 'Meme').slice(0, 200);
      const channelPrice = ch?.priceCoins;
      const priceCoins = Number.isFinite(channelPrice) ? (channelPrice as number) : defaultPriceCoins;
      return {
        id: r.id,
        channelId: channel.id,
        channelMemeId: r.id,
        memeAssetId: r.id,
        title,
        type: r.type,
        fileUrl: r.fileUrl ?? null,
        durationMs: r.durationMs,
        priceCoins,
        status: 'approved',
        deletedAt: null,
        createdAt: r.createdAt,
        createdBy: r.createdBy ? { id: r.createdBy.id, displayName: r.createdBy.displayName } : null,
        fileHash: null,
      };
    });
  } else {
    const baseWhere = {
      channelId: channel.id,
      status: 'approved',
      deletedAt: null,
    };
    const cursorFilter = cursor ? buildCursorFilter(cursorSchema, cursor) : null;
    const where = mergeCursorWhere(baseWhere, cursorFilter);
    const orderBy = priceSortEnabled
      ? [{ priceCoins: sortOrder }, { createdAt: 'desc' as const }, { id: 'desc' as const }]
      : [{ createdAt: sortOrder }, { id: 'desc' as const }];
    const rows = await prisma.channelMeme.findMany({
      where,
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
      orderBy: orderBy as Prisma.ChannelMemeOrderByWithRelationInput[],
      take: limit + 1,
    });

    hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    items = (sliced as ChannelMemeRow[]).map((r) => toChannelMemeListItemDto(req, channel.id, r));
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
