import type { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { buildSearchTerms } from '../../../shared/utils/searchTerms.js';
import { parseTagNames } from '../cache.js';
import {
  buildCooldownPayload,
  getSourceType,
  loadLegacyTagsById,
  toChannelMemeListItemDto,
  type ChannelMemeListItemDto,
  type MemeTagDto,
} from '../channelMemeListDto.js';
import { buildChannelMemeVisibilityFilter, buildMemeAssetVisibilityFilter, applyViewerMemeState, loadViewerMemeState } from '../memeViewerState.js';
import { sendSearchResponse, type PoolAssetRow, type ChannelMemeRow, type SearchContext } from './searchShared.js';

type SearchRowsResult = {
  items: Array<ChannelMemeListItemDto | Record<string, unknown>>;
};

function defaultPriceCoinsFromChannel(ctx: SearchContext): number {
  const raw = ctx.targetChannel?.defaultPriceCoins ?? null;
  return Number.isFinite(raw as number) ? Number(raw) : 100;
}

function mapPoolRows(
  rows: PoolAssetRow[],
  channelId: string,
  defaultPriceCoins: number,
  tagsByChannelMemeId?: Map<string, MemeTagDto[]>
): Array<Record<string, unknown>> {
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

function applyChannelSearchFilters(where: Prisma.ChannelMemeWhereInput, ctx: SearchContext) {
  if (ctx.qStr) {
    const terms = buildSearchTerms(ctx.qStr);
    const searchTerms = terms.length > 0 ? terms : [ctx.qStr];
    where.OR = searchTerms.flatMap((term) => [
      { title: { contains: term, mode: 'insensitive' } },
      { memeAsset: { aiAutoTitle: { contains: term, mode: 'insensitive' } } },
      { memeAsset: { aiSearchText: { contains: term, mode: 'insensitive' } } },
    ]);
    if (ctx.includeUploaderEnabled) {
      where.OR.push({ memeAsset: { createdBy: { displayName: { contains: ctx.qStr, mode: 'insensitive' } } } });
    }
  }

  if (ctx.tagsStr) {
    const tagNames = parseTagNames(ctx.tagsStr);
    if (tagNames.length > 0) {
      where.AND = tagNames.map((tag: string) => ({
        tags: { some: { tag: { name: { contains: tag, mode: 'insensitive' } } } },
      }));
    }
  }
}

function applyPoolSearchFilters(where: Prisma.MemeAssetWhereInput, ctx: SearchContext) {
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
}

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

function getMemeAssetIds(items: Array<Record<string, unknown>>): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    const assetId = typeof item.memeAssetId === 'string' ? item.memeAssetId : typeof item.id === 'string' ? item.id : '';
    if (assetId) ids.add(assetId);
  }
  return Array.from(ids);
}

async function attachViewerState(ctx: SearchContext, items: Array<Record<string, unknown>>) {
  const state = await loadViewerMemeState({
    userId: ctx.req.userId ?? null,
    channelId: ctx.targetChannelId ?? null,
    memeAssetIds: getMemeAssetIds(items),
  });
  const withState = applyViewerMemeState(items, state);
  if (!ctx.targetChannelId) return withState;
  return withState;
}

async function buildChannelItems(
  ctx: SearchContext,
  rows: ChannelMemeRow[],
  orderedIds?: string[]
): Promise<Array<Record<string, unknown>>> {
  const legacyTagsById = await loadLegacyTagsById(rows.map((r) => r.id));
  const items = rows.map((r) => {
    const item = toChannelMemeListItemDto(ctx.req, ctx.targetChannelId!, r);
    const tags = legacyTagsById.get(r.id);
    return tags && tags.length > 0 ? ({ ...item, tags } as Record<string, unknown>) : (item as Record<string, unknown>);
  });

  if (!orderedIds || orderedIds.length === 0) return items;
  const byId = new Map(items.map((item) => [String(item.memeAssetId || item.id), item]));
  return orderedIds.map((id) => byId.get(id)).filter(Boolean) as Array<Record<string, unknown>>;
}

async function buildPoolItems(
  ctx: SearchContext,
  rows: PoolAssetRow[],
  orderedIds?: string[]
): Promise<Array<Record<string, unknown>>> {
  const legacyTagsById = await loadLegacyTagsById(
    rows.flatMap((row) =>
      Array.isArray(row.channelMemes)
        ? row.channelMemes.map((ch) => ch?.id ?? null)
        : []
    )
  );
  const items = mapPoolRows(rows, ctx.targetChannelId!, defaultPriceCoinsFromChannel(ctx), legacyTagsById);
  if (!orderedIds || orderedIds.length === 0) return items;
  const byId = new Map(items.map((item) => [String(item.memeAssetId || item.id), item]));
  return orderedIds.map((id) => byId.get(id)).filter(Boolean) as Array<Record<string, unknown>>;
}

async function loadFavorites(ctx: SearchContext): Promise<SearchRowsResult | null> {
  if (ctx.listMode !== 'favorites') return null;
  if (!ctx.req.userId || !ctx.targetChannelId) return { items: [] };

  const channelId = ctx.targetChannelId;
  const userId = ctx.req.userId;
  const isPoolMode = ctx.memeCatalogMode === 'pool_all';

  const visibility = buildMemeAssetVisibilityFilter({ channelId, userId, includeUserHidden: true });
  const assetWhere: Prisma.MemeAssetWhereInput = {
    ...(isPoolMode ? { status: 'active', deletedAt: null, fileUrl: { not: '' } } : {}),
  };
  if (visibility) Object.assign(assetWhere, visibility);

  const channelWhere: Prisma.ChannelMemeWhereInput = {
    channelId,
    status: 'approved',
    deletedAt: null,
  };
  applyChannelSearchFilters(channelWhere, ctx);
  const channelVisibility = buildChannelMemeVisibilityFilter({ channelId, userId, includeUserHidden: true });
  if (channelVisibility) mergeAnd(channelWhere, channelVisibility);

  if (!isPoolMode) {
    assetWhere.channelMemes = { some: channelWhere };
  } else {
    applyPoolSearchFilters(assetWhere, ctx);
  }

  const favoriteWhere: Prisma.UserMemeFavoriteWhereInput = {
    userId,
    channelId,
    memeAsset: { is: assetWhere },
  };

  const favoriteRows = await prisma.userMemeFavorite.findMany({
    where: favoriteWhere,
    orderBy: { createdAt: 'desc' },
    take: ctx.parsedLimit,
    skip: ctx.parsedOffset,
    select: { memeAssetId: true },
  });
  const favoriteIds = favoriteRows.map((row) => row.memeAssetId);
  if (favoriteIds.length === 0) return { items: [] };

  if (!isPoolMode) {
    const rows = (await prisma.channelMeme.findMany({
      where: {
        channelId,
        status: 'approved',
        deletedAt: null,
        memeAssetId: { in: favoriteIds },
      },
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
    const items = await buildChannelItems(ctx, rows, favoriteIds);
    return { items };
  }

  const rows = (await prisma.memeAsset.findMany({
    where: { id: { in: favoriteIds } },
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
        where: { channelId, status: 'approved', deletedAt: null },
        take: 1,
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, priceCoins: true, cooldownMinutes: true, lastActivatedAt: true },
      },
    },
  })) as PoolAssetRow[];
  const items = await buildPoolItems(ctx, rows, favoriteIds);
  return { items };
}

async function loadHidden(ctx: SearchContext): Promise<SearchRowsResult | null> {
  if (ctx.listMode !== 'hidden') return null;
  if (!ctx.req.userId || !ctx.targetChannelId) return { items: [] };

  const channelId = ctx.targetChannelId;
  const userId = ctx.req.userId;
  const isPoolMode = ctx.memeCatalogMode === 'pool_all';

  const visibility = buildMemeAssetVisibilityFilter({ channelId, userId, includeUserHidden: false });
  const assetWhere: Prisma.MemeAssetWhereInput = {
    ...(isPoolMode ? { status: 'active', deletedAt: null, fileUrl: { not: '' } } : {}),
  };
  if (visibility) Object.assign(assetWhere, visibility);

  const channelWhere: Prisma.ChannelMemeWhereInput = {
    channelId,
    status: 'approved',
    deletedAt: null,
  };
  applyChannelSearchFilters(channelWhere, ctx);
  const channelVisibility = buildChannelMemeVisibilityFilter({ channelId, userId, includeUserHidden: false });
  if (channelVisibility) mergeAnd(channelWhere, channelVisibility);

  if (!isPoolMode) {
    assetWhere.channelMemes = { some: channelWhere };
  } else {
    applyPoolSearchFilters(assetWhere, ctx);
  }

  const hiddenWhere: Prisma.UserMemeBlocklistWhereInput = {
    userId,
    channelId,
    memeAsset: { is: assetWhere },
  };

  const hiddenRows = await prisma.userMemeBlocklist.findMany({
    where: hiddenWhere,
    orderBy: { createdAt: 'desc' },
    take: ctx.parsedLimit,
    skip: ctx.parsedOffset,
    select: { memeAssetId: true },
  });
  const hiddenIds = hiddenRows.map((row) => row.memeAssetId);
  if (hiddenIds.length === 0) return { items: [] };

  if (!isPoolMode) {
    const rows = (await prisma.channelMeme.findMany({
      where: {
        channelId,
        status: 'approved',
        deletedAt: null,
        memeAssetId: { in: hiddenIds },
      },
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
    const items = await buildChannelItems(ctx, rows, hiddenIds);
    return { items };
  }

  const rows = (await prisma.memeAsset.findMany({
    where: { id: { in: hiddenIds } },
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
        where: { channelId, status: 'approved', deletedAt: null },
        take: 1,
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, priceCoins: true, cooldownMinutes: true, lastActivatedAt: true },
      },
    },
  })) as PoolAssetRow[];
  const items = await buildPoolItems(ctx, rows, hiddenIds);
  return { items };
}

async function loadBlocked(ctx: SearchContext): Promise<SearchRowsResult | null> {
  if (ctx.listMode !== 'blocked') return null;
  if (!ctx.req.userId || !ctx.targetChannelId) return { items: [] };

  const channelId = ctx.targetChannelId;
  const isAdmin = String(ctx.req.userRole || '') === 'admin';
  const isOwner = String(ctx.req.channelId || '') === String(channelId);
  if (!isAdmin && !isOwner) return { items: [] };

  const blockedRows = await prisma.channelMemeBlocklist.findMany({
    where: { channelId },
    orderBy: { createdAt: 'desc' },
    take: ctx.parsedLimit,
    skip: ctx.parsedOffset,
    select: { memeAssetId: true },
  });
  const blockedIds = blockedRows.map((row) => row.memeAssetId);
  if (blockedIds.length === 0) return { items: [] };

  const assetWhere: Prisma.MemeAssetWhereInput = { id: { in: blockedIds } };
  applyPoolSearchFilters(assetWhere, ctx);

  const rows = (await prisma.memeAsset.findMany({
    where: assetWhere,
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
        where: { channelId, status: 'approved', deletedAt: null },
        take: 1,
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, priceCoins: true, cooldownMinutes: true, lastActivatedAt: true },
      },
    },
  })) as PoolAssetRow[];
  const items = await buildPoolItems(ctx, rows, blockedIds);
  return { items };
}

async function loadFrequent(ctx: SearchContext): Promise<SearchRowsResult | null> {
  if (ctx.listMode !== 'frequent') return null;
  if (!ctx.req.userId || !ctx.targetChannelId) return { items: [] };

  const channelId = ctx.targetChannelId;
  const userId = ctx.req.userId;
  const favoritesStatuses = ['queued', 'playing', 'done', 'completed'];
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const rows = await prisma.memeActivation.groupBy({
    by: ['channelMemeId'],
    where: {
      channelId,
      userId,
      status: { in: favoritesStatuses },
      createdAt: { gte: since },
    },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: ctx.parsedLimit,
    skip: ctx.parsedOffset,
  });

  const channelMemeIds = rows.map((r) => r.channelMemeId);
  if (channelMemeIds.length === 0) return { items: [] };

  const where: Prisma.ChannelMemeWhereInput = {
    channelId,
    status: 'approved',
    deletedAt: null,
    id: { in: channelMemeIds },
  };
  applyChannelSearchFilters(where, ctx);
  const visibility = buildChannelMemeVisibilityFilter({ channelId, userId, includeUserHidden: true });
  if (visibility) mergeAnd(where, visibility);

  const channelRows = (await prisma.channelMeme.findMany({
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
  })) as ChannelMemeRow[];

  const assetOrder = channelMemeIds
    .map((channelMemeId) => channelRows.find((row) => row.id === channelMemeId)?.memeAssetId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const items = await buildChannelItems(ctx, channelRows, assetOrder.length > 0 ? assetOrder : undefined);
  return { items };
}

async function loadRecent(ctx: SearchContext): Promise<SearchRowsResult | null> {
  if (ctx.listMode !== 'recent') return null;
  if (!ctx.req.userId || !ctx.targetChannelId) return { items: [] };

  const channelId = ctx.targetChannelId;
  const userId = ctx.req.userId;
  const favoritesStatuses = ['queued', 'playing', 'done', 'completed'];
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const rows = await prisma.memeActivation.groupBy({
    by: ['channelMemeId'],
    where: {
      channelId,
      userId,
      status: { in: favoritesStatuses },
      createdAt: { gte: since },
    },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: 'desc' } },
    take: ctx.parsedLimit,
    skip: ctx.parsedOffset,
  });

  const channelMemeIds = rows.map((r) => r.channelMemeId);
  if (channelMemeIds.length === 0) return { items: [] };

  const where: Prisma.ChannelMemeWhereInput = {
    channelId,
    status: 'approved',
    deletedAt: null,
    id: { in: channelMemeIds },
  };
  applyChannelSearchFilters(where, ctx);
  const visibility = buildChannelMemeVisibilityFilter({ channelId, userId, includeUserHidden: true });
  if (visibility) mergeAnd(where, visibility);

  const channelRows = (await prisma.channelMeme.findMany({
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
  })) as ChannelMemeRow[];

  const assetOrder = channelMemeIds
    .map((channelMemeId) => channelRows.find((row) => row.id === channelMemeId)?.memeAssetId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const items = await buildChannelItems(ctx, channelRows, assetOrder.length > 0 ? assetOrder : undefined);
  return { items };
}

async function loadTrending(ctx: SearchContext): Promise<SearchRowsResult | null> {
  if (ctx.listMode !== 'trending') return null;
  if (!ctx.targetChannelId) return { items: [] };

  const channelId = ctx.targetChannelId;
  const periodDays = ctx.trendingPeriod;
  const scope = ctx.trendingScope;
  const isPoolMode = ctx.memeCatalogMode === 'pool_all';

  let channelMemeIds: string[] = [];
  let memeAssetIds: string[] = [];
  if (scope === 'channel') {
    if (periodDays === 7) {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const rows = await prisma.channelMemeDailyStats.groupBy({
        by: ['channelMemeId'],
        where: { channelId, day: { gte: since } },
        _sum: { completedActivationsCount: true },
        orderBy: { _sum: { completedActivationsCount: 'desc' } },
        take: ctx.parsedLimit,
        skip: ctx.parsedOffset,
      });
      channelMemeIds = rows.map((r) => r.channelMemeId);
    } else {
      const rows = await prisma.channelMemeStats30d.findMany({
        where: { channelId },
        orderBy: { completedActivationsCount: 'desc' },
        take: ctx.parsedLimit,
        skip: ctx.parsedOffset,
        select: { channelMemeId: true },
      });
      channelMemeIds = rows.map((r) => r.channelMemeId);
    }
  } else {
    if (periodDays === 7) {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const rows = await prisma.globalMemeDailyStats.groupBy({
        by: ['memeAssetId'],
        where: { day: { gte: since } },
        _sum: { completedActivationsCount: true },
        orderBy: { _sum: { completedActivationsCount: 'desc' } },
        take: ctx.parsedLimit,
        skip: ctx.parsedOffset,
      });
      memeAssetIds = rows.map((r) => r.memeAssetId);
    } else {
      const rows = await prisma.globalMemeStats30d.findMany({
        orderBy: { completedActivationsCount: 'desc' },
        take: ctx.parsedLimit,
        skip: ctx.parsedOffset,
        select: { memeAssetId: true },
      });
      memeAssetIds = rows.map((r) => r.memeAssetId);
    }
  }

  if (scope === 'channel') {
    if (channelMemeIds.length === 0) return { items: [] };
  } else if (memeAssetIds.length === 0) {
    return { items: [] };
  }

  const channelWhere: Prisma.ChannelMemeWhereInput = {
    channelId,
    status: 'approved',
    deletedAt: null,
  };
  if (scope === 'channel') {
    channelWhere.id = { in: channelMemeIds };
  } else {
    channelWhere.memeAssetId = { in: memeAssetIds };
  }
  applyChannelSearchFilters(channelWhere, ctx);
  const channelVisibility = buildChannelMemeVisibilityFilter({
    channelId,
    userId: ctx.req.userId ?? null,
    includeUserHidden: true,
  });
  if (channelVisibility) mergeAnd(channelWhere, channelVisibility);

  if (!isPoolMode) {
    const rows = (await prisma.channelMeme.findMany({
      where: channelWhere,
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
    const assetOrder =
      scope === 'channel'
        ? channelMemeIds
            .map((channelMemeId) => rows.find((row) => row.id === channelMemeId)?.memeAssetId)
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
        : memeAssetIds.filter((assetId) => rows.some((row) => row.memeAssetId === assetId));
    const items = await buildChannelItems(ctx, rows, assetOrder.length > 0 ? assetOrder : undefined);
    return { items };
  }

  const channelMemes =
    scope === 'channel'
      ? await prisma.channelMeme.findMany({
          where: { id: { in: channelMemeIds }, channelId, status: 'approved', deletedAt: null },
          select: { id: true, memeAssetId: true },
        })
      : [];
  const assetByChannelMeme = new Map(channelMemes.map((cm) => [cm.id, cm.memeAssetId]));
  const orderedAssets: string[] = [];
  const seen = new Set<string>();
  if (scope === 'channel') {
    for (const channelMemeId of channelMemeIds) {
      const assetId = assetByChannelMeme.get(channelMemeId);
      if (!assetId || seen.has(assetId)) continue;
      seen.add(assetId);
      orderedAssets.push(assetId);
    }
  } else {
    for (const assetId of memeAssetIds) {
      if (!assetId || seen.has(assetId)) continue;
      seen.add(assetId);
      orderedAssets.push(assetId);
    }
  }
  if (orderedAssets.length === 0) return { items: [] };

  const assetWhere: Prisma.MemeAssetWhereInput = { id: { in: orderedAssets } };
  const visibility = buildMemeAssetVisibilityFilter({
    channelId,
    userId: ctx.req.userId ?? null,
    includeUserHidden: true,
  });
  if (visibility) Object.assign(assetWhere, visibility);
  applyPoolSearchFilters(assetWhere, ctx);

  const rows = (await prisma.memeAsset.findMany({
    where: assetWhere,
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
        where: { channelId, status: 'approved', deletedAt: null },
        take: 1,
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, priceCoins: true, cooldownMinutes: true, lastActivatedAt: true },
      },
    },
  })) as PoolAssetRow[];
  const items = await buildPoolItems(ctx, rows, orderedAssets);
  return { items };
}

export async function handleListMode(ctx: SearchContext) {
  if (!ctx.listMode) return null;

  const handlers = [loadFavorites, loadFrequent, loadRecent, loadHidden, loadBlocked, loadTrending];
  for (const handler of handlers) {
    const result = await handler(ctx);
    if (!result) continue;
    const withState = await attachViewerState(ctx, result.items);
    return sendSearchResponse(ctx.req, ctx.res, withState);
  }

  return null;
}
