import type { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import {
  buildCooldownPayload,
  getSourceType,
  loadLegacyTagsById,
  toChannelMemeListItemDto,
  type MemeTagDto,
} from '../channelMemeListDto.js';
import { parseTagNames } from '../cache.js';
import { sendSearchResponse, type ChannelMemeRow, type PoolAssetRow, type SearchContext } from './searchShared.js';
import { buildSearchTerms } from '../../../shared/utils/searchTerms.js';
import {
  applyViewerMemeState,
  buildChannelMemeVisibilityFilter,
  buildMemeAssetVisibilityFilter,
  loadViewerMemeState,
} from '../memeViewerState.js';

function defaultPriceCoinsFromChannel(ctx: SearchContext): number {
  const raw = ctx.targetChannel?.defaultPriceCoins ?? null;
  return Number.isFinite(raw as number) ? Number(raw) : 100;
}

function mapPoolRows(
  rows: PoolAssetRow[],
  channelId: string,
  defaultPriceCoins: number,
  tagsByChannelMemeId?: Map<string, MemeTagDto[]>
) {
  return rows.map((r) => {
    const ch = Array.isArray(r.channelMemes) && r.channelMemes.length > 0 ? r.channelMemes[0] : null;
    const title = String(ch?.title || r.aiAutoTitle || 'Meme').slice(0, 200);
    const channelPrice = ch?.priceCoins;
    const priceCoins = Number.isFinite(channelPrice) ? (channelPrice as number) : defaultPriceCoins;
    const legacyTags = tagsByChannelMemeId?.get(ch?.id ?? '');
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
      channelId,
      channelMemeId: ch?.id ?? r.id,
      memeAssetId: r.id,
      title,
      type: r.type,
      previewUrl: preview?.fileUrl ?? null,
      variants,
      fileUrl: variants[0]?.fileUrl ?? preview?.fileUrl ?? r.fileUrl ?? null,
      durationMs: r.durationMs,
      qualityScore: r.qualityScore ?? null,
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
}

async function attachViewerState(ctx: SearchContext, items: Array<Record<string, unknown>>) {
  const memeAssetIds = items
    .map((item) => (typeof item.memeAssetId === 'string' ? item.memeAssetId : typeof item.id === 'string' ? item.id : ''))
    .filter((id) => id && id.length > 0);
  const state = await loadViewerMemeState({
    userId: ctx.req.userId ?? null,
    channelId: ctx.targetChannelId ?? null,
    memeAssetIds,
  });
  const withState = applyViewerMemeState(items, state);
  if (!ctx.targetChannelId) return withState;
  return withState;
}

function mergeChannelAnd(where: Prisma.ChannelMemeWhereInput, extra: Prisma.ChannelMemeWhereInput) {
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

export async function handleChannelListingMode(ctx: SearchContext) {
  const isChannelListingMode =
    !!ctx.targetChannelId &&
    !ctx.favoritesEnabled &&
    !ctx.listMode &&
    !ctx.qStr &&
    !ctx.tagsStr &&
    ctx.minPrice === undefined &&
    ctx.maxPrice === undefined &&
    !ctx.includeUploaderEnabled &&
    (ctx.sortByStr === 'createdAt' || ctx.sortByStr === 'priceCoins');

  if (!isChannelListingMode) return null;

  if (ctx.memeCatalogMode === 'pool_all') {
    const poolWhere: Prisma.MemeAssetWhereInput = {
      status: 'active',
      deletedAt: null,
      fileUrl: { not: '' },
      NOT: {
        channelMemes: {
          some: {
            channelId: ctx.targetChannelId!,
            OR: [{ status: { not: 'approved' } }, { deletedAt: { not: null } }],
          },
        },
      },
    };
    const visibility = buildMemeAssetVisibilityFilter({
      channelId: ctx.targetChannelId!,
      userId: ctx.req.userId ?? null,
      includeUserHidden: true,
    });
    if (visibility) Object.assign(poolWhere, visibility);

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
          where: { channelId: ctx.targetChannelId!, status: 'approved', deletedAt: null },
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { id: true, title: true, priceCoins: true, cooldownMinutes: true, lastActivatedAt: true },
        },
      },
    })) as PoolAssetRow[];

    const legacyTagsById = await loadLegacyTagsById(
      rows.flatMap((row) => (Array.isArray(row.channelMemes) ? row.channelMemes.map((ch) => ch?.id ?? null) : []))
    );
    const items = mapPoolRows(rows, ctx.targetChannelId!, defaultPriceCoinsFromChannel(ctx), legacyTagsById);
    const withState = await attachViewerState(ctx, items);
    return sendSearchResponse(ctx.req, ctx.res, withState);
  }

  const orderBy =
    ctx.sortByStr === 'priceCoins'
      ? [{ priceCoins: ctx.sortOrderStr }, { createdAt: 'desc' as const }, { id: 'desc' as const }]
      : [{ createdAt: ctx.sortOrderStr }, { id: 'desc' as const }];

  const baseWhere: Prisma.ChannelMemeWhereInput = {
    channelId: ctx.targetChannelId!,
    status: 'approved',
    deletedAt: null,
  };
  const channelVisibility = buildChannelMemeVisibilityFilter({
    channelId: ctx.targetChannelId!,
    userId: ctx.req.userId ?? null,
    includeUserHidden: true,
  });
  if (channelVisibility) mergeChannelAnd(baseWhere, channelVisibility);

  const rows = (await prisma.channelMeme.findMany({
    where: baseWhere,
    orderBy,
    take: ctx.parsedLimit,
    skip: ctx.parsedOffset,
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
  })) as ChannelMemeRow[];

  const legacyTagsById = await loadLegacyTagsById(rows.map((r) => r.id));
  const items = rows.map((r) => {
    const item = toChannelMemeListItemDto(ctx.req, ctx.targetChannelId!, r);
    const tags = legacyTagsById.get(r.id);
    return tags && tags.length > 0 ? { ...item, tags } : item;
  });
  const withState = await attachViewerState(ctx, items as Array<Record<string, unknown>>);
  return sendSearchResponse(ctx.req, ctx.res, withState);
}

export async function handlePoolAllChannelFilterMode(ctx: SearchContext) {
  const isPoolAllChannelFilterMode =
    !!ctx.targetChannelId &&
    ctx.memeCatalogMode === 'pool_all' &&
    !ctx.favoritesEnabled &&
    !ctx.listMode &&
    (!!ctx.qStr || !!ctx.tagsStr) &&
    ctx.minPrice === undefined &&
    ctx.maxPrice === undefined &&
    (ctx.sortByStr === 'createdAt' || ctx.sortByStr === 'priceCoins');

  if (!isPoolAllChannelFilterMode) return null;

  const poolWhere: Prisma.MemeAssetWhereInput = {
    status: 'active',
    deletedAt: null,
    fileUrl: { not: '' },
    NOT: {
      channelMemes: {
        some: {
          channelId: ctx.targetChannelId!,
          OR: [{ status: { not: 'approved' } }, { deletedAt: { not: null } }],
        },
      },
    },
  };
  const visibility = buildMemeAssetVisibilityFilter({
    channelId: ctx.targetChannelId!,
    userId: ctx.req.userId ?? null,
    includeUserHidden: true,
  });
  if (visibility) Object.assign(poolWhere, visibility);

  const and: Prisma.MemeAssetWhereInput[] = [];
  const tagNames = parseTagNames(ctx.tagsStr);
  for (const t of tagNames) {
    and.push({ aiSearchText: { contains: t, mode: 'insensitive' } });
  }
  if (and.length > 0) poolWhere.AND = and;

  if (ctx.qStr) {
    const terms = buildSearchTerms(ctx.qStr);
    const searchTerms = terms.length > 0 ? terms : [ctx.qStr];
    poolWhere.OR = searchTerms.flatMap((term) => [
      { aiAutoTitle: { contains: term, mode: 'insensitive' } },
      { aiSearchText: { contains: term, mode: 'insensitive' } },
      { channelMemes: { some: { title: { contains: term, mode: 'insensitive' } } } },
    ]);
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
        where: { channelId: ctx.targetChannelId!, status: 'approved', deletedAt: null },
        take: 1,
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, priceCoins: true, cooldownMinutes: true, lastActivatedAt: true },
      },
    },
  })) as PoolAssetRow[];

  const legacyTagsById = await loadLegacyTagsById(
    rows.flatMap((row) => (Array.isArray(row.channelMemes) ? row.channelMemes.map((ch) => ch?.id ?? null) : []))
  );
  const items = mapPoolRows(rows, ctx.targetChannelId!, defaultPriceCoinsFromChannel(ctx), legacyTagsById);
  const withState = await attachViewerState(ctx, items);
  return sendSearchResponse(ctx.req, ctx.res, withState);
}

export async function handleChannelSearchMode(ctx: SearchContext) {
  const isChannelSearchMode =
    !!ctx.targetChannelId &&
    !ctx.favoritesEnabled &&
    !ctx.listMode &&
    (!!ctx.qStr || !!ctx.tagsStr) &&
    ctx.minPrice === undefined &&
    ctx.maxPrice === undefined &&
    (ctx.sortByStr === 'createdAt' || ctx.sortByStr === 'priceCoins');

  if (!isChannelSearchMode) return null;

  if (ctx.memeCatalogMode === 'pool_all') {
    const where: Prisma.MemeAssetWhereInput = {
      status: 'active',
      deletedAt: null,
      fileUrl: { not: '' },
      NOT: {
        channelMemes: {
          some: {
            channelId: ctx.targetChannelId!,
            OR: [{ status: { not: 'approved' } }, { deletedAt: { not: null } }],
          },
        },
      },
    };
    const visibility = buildMemeAssetVisibilityFilter({
      channelId: ctx.targetChannelId!,
      userId: ctx.req.userId ?? null,
      includeUserHidden: true,
    });
    if (visibility) Object.assign(where, visibility);
    if (ctx.tagsStr) {
      const tagNames = parseTagNames(ctx.tagsStr);
      if (tagNames.length > 0) {
        where.AND = tagNames.map((tag: string) => ({ aiSearchText: { contains: tag, mode: 'insensitive' } }));
      }
    }
    if (ctx.qStr) {
      const terms = buildSearchTerms(ctx.qStr);
      const searchTerms = terms.length > 0 ? terms : [ctx.qStr];
      where.OR = searchTerms.flatMap((term) => [
        { aiAutoTitle: { contains: term, mode: 'insensitive' } },
        { aiSearchText: { contains: term, mode: 'insensitive' } },
        { channelMemes: { some: { title: { contains: term, mode: 'insensitive' } } } },
      ]);
      if (ctx.includeUploaderEnabled) {
        where.OR.push({ createdBy: { displayName: { contains: ctx.qStr, mode: 'insensitive' } } });
      }
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
        qualityScore: true,
        createdAt: true,
        aiAutoTitle: true,
        createdBy: { select: { id: true, displayName: true } },
        channelMemes: {
          where: { channelId: ctx.targetChannelId!, status: 'approved', deletedAt: null },
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { id: true, title: true, priceCoins: true, cooldownMinutes: true, lastActivatedAt: true },
        },
      },
    })) as PoolAssetRow[];

    const legacyTagsById = await loadLegacyTagsById(
      rows.flatMap((row) => (Array.isArray(row.channelMemes) ? row.channelMemes.map((ch) => ch?.id ?? null) : []))
    );
    const items = mapPoolRows(rows, ctx.targetChannelId!, defaultPriceCoinsFromChannel(ctx), legacyTagsById);
    const withState = await attachViewerState(ctx, items);
    return sendSearchResponse(ctx.req, ctx.res, withState);
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
  const channelVisibility = buildChannelMemeVisibilityFilter({
    channelId: ctx.targetChannelId!,
    userId: ctx.req.userId ?? null,
    includeUserHidden: true,
  });
  if (channelVisibility) mergeChannelAnd(where, channelVisibility);
  if (ctx.qStr) {
    const terms = buildSearchTerms(ctx.qStr);
    const searchTerms = terms.length > 0 ? terms : [ctx.qStr];
    where.OR = searchTerms.flatMap((term) => [
      { title: { contains: term, mode: 'insensitive' } },
      { memeAsset: { aiAutoTitle: { contains: term, mode: 'insensitive' } } },
      { memeAsset: { aiSearchText: { contains: term, mode: 'insensitive' } } },
    ]);
  }
  if (ctx.tagsStr) {
    const tagNames = parseTagNames(ctx.tagsStr);
    if (tagNames.length > 0) {
      where.AND = tagNames.map((tag: string) => ({
        tags: { some: { tag: { name: { contains: tag, mode: 'insensitive' } } } },
      }));
    }
  }
  if (ctx.includeUploaderEnabled && ctx.qStr) {
    if (!where.OR) where.OR = [];
    where.OR.push({ memeAsset: { createdBy: { displayName: { contains: ctx.qStr, mode: 'insensitive' } } } });
  }

  const rows = (await prisma.channelMeme.findMany({
    where,
    orderBy,
    take: ctx.parsedLimit,
    skip: ctx.parsedOffset,
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
  })) as ChannelMemeRow[];

  const legacyTagsById = await loadLegacyTagsById(rows.map((r) => r.id));
  const items = rows.map((r) => {
    const item = toChannelMemeListItemDto(ctx.req, ctx.targetChannelId!, r);
    const tags = legacyTagsById.get(r.id);
    return tags && tags.length > 0 ? { ...item, tags } : item;
  });
  const withState = await attachViewerState(ctx, items as Array<Record<string, unknown>>);
  return sendSearchResponse(ctx.req, ctx.res, withState);
}
