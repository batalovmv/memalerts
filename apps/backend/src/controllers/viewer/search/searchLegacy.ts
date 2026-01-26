import type { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { parseTagNames } from '../cache.js';
import { toChannelMemeListItemDto } from '../channelMemeListDto.js';
import { buildSearchTerms } from '../../../shared/utils/searchTerms.js';
import { sendSearchResponse, type SearchContext } from './searchShared.js';

const FAVORITE_STATUSES = ['queued', 'playing', 'done', 'completed'];

function mergeAnd(where: Prisma.ChannelMemeWhereInput, extra: Prisma.ChannelMemeWhereInput) {
  if (!where.AND) {
    where.AND = [extra];
    return;
  }
  if (Array.isArray(where.AND)) {
    where.AND.push(extra);
    return;
  }
  where.AND = [where.AND, extra];
}

export async function handleLegacySearch(ctx: SearchContext, rawQuery: Record<string, unknown>) {
  const qStr = rawQuery.q ? String(rawQuery.q).trim().slice(0, 100) : '';

  const where: Prisma.ChannelMemeWhereInput = {
    status: 'approved',
    deletedAt: null,
  };

  if (ctx.targetChannelId) {
    where.channelId = ctx.targetChannelId;
  }

  if (ctx.minPrice) {
    const existing = typeof where.priceCoins === 'object' ? where.priceCoins : {};
    where.priceCoins = {
      ...existing,
      gte: parseInt(String(ctx.minPrice), 10),
    };
  }
  if (ctx.maxPrice) {
    const existing = typeof where.priceCoins === 'object' ? where.priceCoins : {};
    where.priceCoins = {
      ...existing,
      lte: parseInt(String(ctx.maxPrice), 10),
    };
  }

  if (qStr) {
    const terms = buildSearchTerms(qStr);
    const searchTerms = terms.length > 0 ? terms : [qStr];
    where.OR = searchTerms.flatMap((term) => [
      { title: { contains: term, mode: 'insensitive' } },
      { memeAsset: { aiAutoTitle: { contains: term, mode: 'insensitive' } } },
      { memeAsset: { aiSearchText: { contains: term, mode: 'insensitive' } } },
    ]);
    if (ctx.includeUploaderEnabled) {
      where.OR.push({ memeAsset: { createdBy: { displayName: { contains: qStr, mode: 'insensitive' } } } });
    }
  }

  if (ctx.tagsStr) {
    const tagNames = parseTagNames(ctx.tagsStr);
    if (tagNames.length === 0) return ctx.res.json([]);
    for (const tag of tagNames) {
      mergeAnd(where, { tags: { some: { tag: { name: { contains: tag, mode: 'insensitive' } } } } });
    }
  }

  const sortOrder: Prisma.SortOrder =
    String(rawQuery.sortOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const sortBy = rawQuery.sortBy === 'priceCoins' ? 'priceCoins' : 'createdAt';
  const orderBy: Prisma.ChannelMemeOrderByWithRelationInput[] =
    sortBy === 'priceCoins'
      ? [{ priceCoins: sortOrder }, { createdAt: 'desc' as const }, { id: 'desc' as const }]
      : [{ createdAt: sortOrder }, { id: 'desc' as const }];

  const favoritesEnabled =
    ctx.favoritesEnabled &&
    ctx.targetChannelId &&
    ctx.req.userId &&
    !qStr &&
    !ctx.tagsStr &&
    !ctx.minPrice &&
    !ctx.maxPrice &&
    rawQuery.sortBy !== 'priceCoins';

  if (favoritesEnabled) {
    const rows = await prisma.memeActivation.groupBy({
      by: ['channelMemeId'],
      where: {
        channelId: ctx.targetChannelId!,
        userId: ctx.req.userId!,
        status: { in: FAVORITE_STATUSES },
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: ctx.parsedLimit,
      skip: ctx.parsedOffset,
    });

    const ids = rows.map((r) => r.channelMemeId);
    if (ids.length === 0) return ctx.res.json([]);

    const memes = await prisma.channelMeme.findMany({
      where: { id: { in: ids }, status: 'approved', deletedAt: null },
      select: {
        id: true,
        channelId: true,
        memeAssetId: true,
        title: true,
        priceCoins: true,
        cooldownMinutes: true,
        lastActivatedAt: true,
        status: true,
        createdAt: true,
        tags: { select: { tag: { select: { id: true, name: true } } } },
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
    });

    const map = new Map(memes.map((m) => [m.id, m]));
    const ordered = ids
      .map((id) => map.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .map((row) => {
        const item = toChannelMemeListItemDto(ctx.req, row.channelId, row);
        const tags = row.tags?.map((t) => t.tag) ?? [];
        return tags.length > 0 ? { ...item, tags } : item;
      });
    return ctx.res.json(ordered);
  }

  const rows = await prisma.channelMeme.findMany({
    where,
    orderBy,
    take: ctx.parsedLimit,
    skip: ctx.parsedOffset,
    select: {
      id: true,
      channelId: true,
      memeAssetId: true,
      title: true,
      priceCoins: true,
      cooldownMinutes: true,
      lastActivatedAt: true,
      status: true,
      createdAt: true,
      tags: { select: { tag: { select: { id: true, name: true } } } },
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
  });

  const items = rows.map((row) => {
    const item = toChannelMemeListItemDto(ctx.req, row.channelId, row);
    const tags = row.tags?.map((t) => t.tag) ?? [];
    return tags.length > 0 ? { ...item, tags } : item;
  });

  return sendSearchResponse(ctx.req, ctx.res, items);
}
