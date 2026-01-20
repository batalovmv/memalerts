import type { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { toChannelMemeListItemDto } from '../channelMemeListDto.js';
import { parseTagNames } from '../cache.js';
import { sendSearchResponse, type ChannelMemeRow, type PoolAssetRow, type SearchContext } from './searchShared.js';

function defaultPriceCoinsFromChannel(ctx: SearchContext): number {
  const raw = ctx.targetChannel?.defaultPriceCoins ?? null;
  return Number.isFinite(raw as number) ? Number(raw) : 100;
}

function mapPoolRows(rows: PoolAssetRow[], channelId: string, defaultPriceCoins: number) {
  return rows.map((r) => {
    const ch = Array.isArray(r.channelMemes) && r.channelMemes.length > 0 ? r.channelMemes[0] : null;
    const title = String(ch?.title || r.aiAutoTitle || 'Meme').slice(0, 200);
    const channelPrice = ch?.priceCoins;
    const priceCoins = Number.isFinite(channelPrice) ? (channelPrice as number) : defaultPriceCoins;
    return {
      id: r.id,
      channelId,
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
}

export async function handleChannelListingMode(ctx: SearchContext) {
  const isChannelListingMode =
    !!ctx.targetChannelId &&
    !ctx.favoritesEnabled &&
    !ctx.qStr &&
    !ctx.tagsStr &&
    ctx.minPrice === undefined &&
    ctx.maxPrice === undefined &&
    !ctx.includeUploaderEnabled &&
    (ctx.sortByStr === 'createdAt' || ctx.sortByStr === 'priceCoins');

  if (!isChannelListingMode) return null;

  if (ctx.memeCatalogMode === 'pool_all') {
    const poolWhere: Prisma.MemeAssetWhereInput = {
      poolVisibility: 'visible',
      purgedAt: null,
      fileUrl: { not: null },
      NOT: {
        channelMemes: {
          some: {
            channelId: ctx.targetChannelId!,
            OR: [{ status: { not: 'approved' } }, { deletedAt: { not: null } }],
          },
        },
      },
    };

    const rows = (await prisma.memeAsset.findMany({
      where: poolWhere,
      orderBy: { createdAt: ctx.sortOrderStr },
      take: ctx.parsedLimit,
      skip: ctx.parsedOffset,
      select: {
        id: true,
        type: true,
        fileUrl: true,
        durationMs: true,
        createdAt: true,
        aiAutoTitle: true,
        createdBy: { select: { id: true, displayName: true } },
        channelMemes: {
          where: { channelId: ctx.targetChannelId!, status: 'approved', deletedAt: null },
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { title: true, priceCoins: true },
        },
      },
    })) as PoolAssetRow[];

    const items = mapPoolRows(rows, ctx.targetChannelId!, defaultPriceCoinsFromChannel(ctx));
    return sendSearchResponse(ctx.req, ctx.res, items);
  }

  const orderBy =
    ctx.sortByStr === 'priceCoins'
      ? [{ priceCoins: ctx.sortOrderStr }, { createdAt: 'desc' as const }, { id: 'desc' as const }]
      : [{ createdAt: ctx.sortOrderStr }, { id: 'desc' as const }];

  const rows = (await prisma.channelMeme.findMany({
    where: { channelId: ctx.targetChannelId!, status: 'approved', deletedAt: null },
    orderBy,
    take: ctx.parsedLimit,
    skip: ctx.parsedOffset,
    select: {
      id: true,
      legacyMemeId: true,
      memeAssetId: true,
      title: true,
      searchText: true,
      aiAutoDescription: true,
      aiAutoTagNamesJson: true,
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
  })) as ChannelMemeRow[];

  const items = rows.map((r) => toChannelMemeListItemDto(ctx.req, ctx.targetChannelId!, r));
  return sendSearchResponse(ctx.req, ctx.res, items);
}

export async function handlePoolAllChannelFilterMode(ctx: SearchContext) {
  const isPoolAllChannelFilterMode =
    !!ctx.targetChannelId &&
    ctx.memeCatalogMode === 'pool_all' &&
    !ctx.favoritesEnabled &&
    (!!ctx.qStr || !!ctx.tagsStr) &&
    ctx.minPrice === undefined &&
    ctx.maxPrice === undefined &&
    (ctx.sortByStr === 'createdAt' || ctx.sortByStr === 'priceCoins');

  if (!isPoolAllChannelFilterMode) return null;

  const poolWhere: Prisma.MemeAssetWhereInput = {
    poolVisibility: 'visible',
    purgedAt: null,
    fileUrl: { not: null },
    NOT: {
      channelMemes: {
        some: {
          channelId: ctx.targetChannelId!,
          OR: [{ status: { not: 'approved' } }, { deletedAt: { not: null } }],
        },
      },
    },
  };

  const and: Prisma.MemeAssetWhereInput[] = [];
  const tagNames = parseTagNames(ctx.tagsStr);
  for (const t of tagNames) {
    and.push({ aiSearchText: { contains: t, mode: 'insensitive' } });
  }
  if (and.length > 0) poolWhere.AND = and;

  if (ctx.qStr) {
    poolWhere.OR = [
      { aiAutoTitle: { contains: ctx.qStr, mode: 'insensitive' } },
      { aiSearchText: { contains: ctx.qStr, mode: 'insensitive' } },
      { channelMemes: { some: { title: { contains: ctx.qStr, mode: 'insensitive' } } } },
    ];
    if (ctx.includeUploaderEnabled) {
      poolWhere.OR.push({ createdBy: { displayName: { contains: ctx.qStr, mode: 'insensitive' } } });
    }
  }

  const rows = (await prisma.memeAsset.findMany({
    where: poolWhere,
    orderBy: { createdAt: ctx.sortOrderStr },
    take: ctx.parsedLimit,
    skip: ctx.parsedOffset,
    select: {
      id: true,
      type: true,
      fileUrl: true,
      durationMs: true,
      createdAt: true,
      aiAutoTitle: true,
      createdBy: { select: { id: true, displayName: true } },
      channelMemes: {
        where: { channelId: ctx.targetChannelId!, status: 'approved', deletedAt: null },
        take: 1,
        orderBy: { createdAt: 'desc' },
        select: { title: true, priceCoins: true },
      },
    },
  })) as PoolAssetRow[];

  const items = mapPoolRows(rows, ctx.targetChannelId!, defaultPriceCoinsFromChannel(ctx));
  return sendSearchResponse(ctx.req, ctx.res, items);
}

export async function handleChannelSearchMode(ctx: SearchContext) {
  const isChannelSearchMode =
    !!ctx.targetChannelId &&
    !ctx.favoritesEnabled &&
    !!ctx.qStr &&
    !ctx.tagsStr &&
    ctx.minPrice === undefined &&
    ctx.maxPrice === undefined &&
    (ctx.sortByStr === 'createdAt' || ctx.sortByStr === 'priceCoins');

  if (!isChannelSearchMode) return null;

  if (ctx.memeCatalogMode === 'pool_all') {
    const where: Prisma.MemeAssetWhereInput = {
      poolVisibility: 'visible',
      purgedAt: null,
      fileUrl: { not: null },
      NOT: {
        channelMemes: {
          some: {
            channelId: ctx.targetChannelId!,
            OR: [{ status: { not: 'approved' } }, { deletedAt: { not: null } }],
          },
        },
      },
    };
    where.OR = [
      { aiAutoTitle: { contains: ctx.qStr, mode: 'insensitive' } },
      { aiSearchText: { contains: ctx.qStr, mode: 'insensitive' } },
      { channelMemes: { some: { title: { contains: ctx.qStr, mode: 'insensitive' } } } },
    ];
    if (ctx.includeUploaderEnabled) {
      where.OR.push({ createdBy: { displayName: { contains: ctx.qStr, mode: 'insensitive' } } });
    }

    const rows = (await prisma.memeAsset.findMany({
      where,
      orderBy: { createdAt: ctx.sortOrderStr },
      take: ctx.parsedLimit,
      skip: ctx.parsedOffset,
      select: {
        id: true,
        type: true,
        fileUrl: true,
        durationMs: true,
        createdAt: true,
        aiAutoTitle: true,
        createdBy: { select: { id: true, displayName: true } },
        channelMemes: {
          where: { channelId: ctx.targetChannelId!, status: 'approved', deletedAt: null },
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { title: true, priceCoins: true },
        },
      },
    })) as PoolAssetRow[];

    const items = mapPoolRows(rows, ctx.targetChannelId!, defaultPriceCoinsFromChannel(ctx));
    return sendSearchResponse(ctx.req, ctx.res, items);
  }

  const orderBy =
    ctx.sortByStr === 'priceCoins'
      ? [{ priceCoins: ctx.sortOrderStr }, { createdAt: 'desc' as const }, { id: 'desc' as const }]
      : [{ createdAt: ctx.sortOrderStr }, { id: 'desc' as const }];

  const where: Prisma.ChannelMemeWhereInput = {
    channelId: ctx.targetChannelId!,
    status: 'approved',
    deletedAt: null,
  };
  where.OR = [
    { title: { contains: ctx.qStr, mode: 'insensitive' } },
    { searchText: { contains: ctx.qStr, mode: 'insensitive' } },
  ];
  if (ctx.includeUploaderEnabled) {
    where.OR.push({ memeAsset: { createdBy: { displayName: { contains: ctx.qStr, mode: 'insensitive' } } } });
  }

  const rows = (await prisma.channelMeme.findMany({
    where,
    orderBy,
    take: ctx.parsedLimit,
    skip: ctx.parsedOffset,
    select: {
      id: true,
      legacyMemeId: true,
      memeAssetId: true,
      title: true,
      searchText: true,
      aiAutoDescription: true,
      aiAutoTagNamesJson: true,
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
  })) as ChannelMemeRow[];

  const items = rows.map((r) => toChannelMemeListItemDto(ctx.req, ctx.targetChannelId!, r));
  return sendSearchResponse(ctx.req, ctx.res, items);
}
