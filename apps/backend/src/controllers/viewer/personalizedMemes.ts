import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { TasteProfileService } from '../../services/taste/TasteProfileService.js';
import {
  buildCooldownPayload,
  getSourceType,
  loadLegacyTagsById,
  toChannelMemeListItemDto,
  type ChannelMemeListItemDto,
  type MemeTagDto,
} from './channelMemeListDto.js';
import {
  applyViewerMemeState,
  buildChannelMemeVisibilityFilter,
  buildMemeAssetVisibilityFilter,
  loadViewerMemeState,
} from './memeViewerState.js';

const MIN_TASTE_ACTIVATIONS = 5;

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

type ScoredItem = {
  item: ChannelMemeListItemDto | Record<string, unknown>;
  score: number;
  createdAt: Date;
  key: string;
  tagNames: string[];
};

function diversifyResults(scoredItems: ScoredItem[], limit: number): ScoredItem[] {
  const MAX_SAME_TOP_TAG = 2;
  const result: ScoredItem[] = [];
  const usedKeys = new Set<string>();
  const topTagCounts: Record<string, number> = {};

  for (const entry of scoredItems) {
    if (result.length >= limit) break;
    if (usedKeys.has(entry.key)) continue;

    const topTag = entry.tagNames?.[0];
    if (topTag) {
      const currentCount = topTagCounts[topTag] ?? 0;
      if (currentCount >= MAX_SAME_TOP_TAG) continue;
      topTagCounts[topTag] = currentCount + 1;
    }

    usedKeys.add(entry.key);
    result.push(entry);
  }

  if (result.length < limit) {
    for (const entry of scoredItems) {
      if (result.length >= limit) break;
      if (usedKeys.has(entry.key)) continue;
      usedKeys.add(entry.key);
      result.push(entry);
    }
  }

  return result;
}

async function loadChannelCandidates(channelId: string, limit: number, userId?: string | null) {
  const where: Prisma.ChannelMemeWhereInput = { channelId, status: 'approved', deletedAt: null };
  const visibility = buildChannelMemeVisibilityFilter({ channelId, userId: userId ?? null, includeUserHidden: true });
  if (visibility) {
    if (!where.AND) where.AND = [visibility];
    else if (Array.isArray(where.AND)) where.AND.push(visibility);
    else where.AND = [where.AND, visibility];
  }
  return prisma.channelMeme.findMany({
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
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
}

async function loadPoolCandidates(channelId: string, limit: number, userId?: string | null) {
  const where: Prisma.MemeAssetWhereInput = {
    status: 'active',
    deletedAt: null,
    fileUrl: { not: '' },
    NOT: {
      channelMemes: {
        some: {
          channelId,
          OR: [{ status: { not: 'approved' } }, { deletedAt: { not: null } }],
        },
      },
    },
  };
  const visibility = buildMemeAssetVisibilityFilter({ channelId, userId: userId ?? null, includeUserHidden: true });
  if (visibility) Object.assign(where, visibility);

  return prisma.memeAsset.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
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
        where: { channelId, status: 'approved', deletedAt: null },
        take: 1,
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, priceCoins: true, cooldownMinutes: true, lastActivatedAt: true },
      },
    },
  });
}

function pickTopItems(scored: ScoredItem[], limit: number): Array<ChannelMemeListItemDto | Record<string, unknown>> {
  const sorted = scored
    .slice()
    .sort((a, b) => b.score - a.score || b.createdAt.getTime() - a.createdAt.getTime());

  const positive = sorted.filter((entry) => entry.score > 0);
  const diversified = diversifyResults(positive, limit);

  const selected: Array<ChannelMemeListItemDto | Record<string, unknown>> = diversified.map((entry) => entry.item);
  const used = new Set<string>(diversified.map((entry) => entry.key));

  for (const entry of sorted) {
    if (selected.length >= limit) break;
    if (used.has(entry.key)) continue;
    used.add(entry.key);
    selected.push(entry.item);
  }

  return selected;
}

export const getPersonalizedMemes = async (req: AuthRequest, res: Response) => {
  const slug = String(req.params.slug || '').trim();
  if (!slug) {
    return res.status(400).json({ errorCode: 'BAD_REQUEST', error: 'Bad request', details: { field: 'slug' } });
  }

  const limitRaw = parseInt(String(req.query.limit ?? ''), 10);
  const candidateRaw = parseInt(String(req.query.candidates ?? ''), 10);
  const limit = clampInt(Number.isFinite(limitRaw) ? limitRaw : 20, 1, 50, 20);
  const candidateLimit = clampInt(
    Number.isFinite(candidateRaw) ? candidateRaw : Math.max(100, limit * 5),
    limit,
    500,
    Math.max(100, limit * 5)
  );

  const channel = await prisma.channel.findFirst({
    where: { slug: { equals: slug, mode: 'insensitive' } },
    select: {
      id: true,
      slug: true,
      memeCatalogMode: true,
      defaultPriceCoins: true,
    },
  });
  if (!channel) {
    return res
      .status(404)
      .json({ errorCode: 'CHANNEL_NOT_FOUND', error: 'Channel not found', details: { entity: 'channel', slug } });
  }

  const profile = await TasteProfileService.getProfile(req.userId!);
  const totalActivations = profile?.totalActivations ?? 0;
  const profileReady = totalActivations >= MIN_TASTE_ACTIVATIONS;
  const catalogMode = String(channel.memeCatalogMode || 'channel');

  const attachViewerState = async (items: Array<Record<string, unknown>>) => {
    const memeAssetIds = items
      .map((item) => (typeof item.memeAssetId === 'string' ? item.memeAssetId : typeof item.id === 'string' ? item.id : ''))
      .filter((id) => id && id.length > 0);
    const state = await loadViewerMemeState({
      userId: req.userId ?? null,
      channelId: channel.id,
      memeAssetIds,
    });
    const withState = applyViewerMemeState(items, state);
    return withState;
  };

  if (!profileReady || !profile) {
    const items =
      catalogMode === 'pool_all'
        ? await buildPoolFallbackItems(req, channel.id, channel.defaultPriceCoins, limit)
        : await buildChannelFallbackItems(req, channel.id, limit);
    const withState = await attachViewerState(items as Array<Record<string, unknown>>);
    return res.json({ items: withState, profileReady: false, totalActivations, mode: 'fallback' });
  }

  if (catalogMode === 'pool_all') {
    const items = await buildPoolPersonalizedItems(req, channel.id, channel.defaultPriceCoins, profile, candidateLimit, limit);
    const withState = await attachViewerState(items as Array<Record<string, unknown>>);
    return res.json({ items: withState, profileReady: true, totalActivations, mode: 'personalized' });
  }

  const items = await buildChannelPersonalizedItems(req, channel.id, profile, candidateLimit, limit);
  const withState = await attachViewerState(items as Array<Record<string, unknown>>);
  return res.json({ items: withState, profileReady: true, totalActivations, mode: 'personalized' });
};

async function buildChannelFallbackItems(
  req: AuthRequest,
  channelId: string,
  limit: number
): Promise<ChannelMemeListItemDto[]> {
  const rows = await loadChannelCandidates(channelId, limit, req.userId);
  const legacyTagsById = await loadLegacyTagsById(rows.map((r) => r.id));
  return rows.map((row) => {
    const item = toChannelMemeListItemDto(req, channelId, row);
    const tags = legacyTagsById.get(row.id);
    return tags && tags.length > 0 ? ({ ...item, tags } as ChannelMemeListItemDto) : item;
  });
}

async function buildChannelPersonalizedItems(
  req: AuthRequest,
  channelId: string,
  profile: Awaited<ReturnType<typeof TasteProfileService.getProfile>>,
  candidateLimit: number,
  limit: number
): Promise<ChannelMemeListItemDto[]> {
  const rows = await loadChannelCandidates(channelId, candidateLimit, req.userId);
  const legacyTagsById = await loadLegacyTagsById(rows.map((r) => r.id));

  const scored: ScoredItem[] = rows.map((row) => {
    const legacyTags = legacyTagsById.get(row.id);
    const tagNames =
      legacyTags && legacyTags.length > 0
        ? legacyTags.map((t) => t.name)
        : Array.isArray(row.memeAsset.aiAutoTagNames)
          ? row.memeAsset.aiAutoTagNames
          : [];
    const score = TasteProfileService.scoreMemeForUser(profile, { tagNames });
    const item = toChannelMemeListItemDto(req, channelId, row);
    const itemWithTags =
      legacyTags && legacyTags.length > 0 ? ({ ...item, tags: legacyTags } as ChannelMemeListItemDto) : item;
    return { item: itemWithTags, score, createdAt: row.createdAt, key: row.id, tagNames };
  });

  return pickTopItems(scored, limit) as ChannelMemeListItemDto[];
}

async function buildPoolFallbackItems(
  req: AuthRequest,
  channelId: string,
  defaultPriceCoins: number | null,
  limit: number
): Promise<Array<Record<string, unknown>>> {
  const rows = await loadPoolCandidates(channelId, limit, req.userId);
  const legacyTagsById = await loadLegacyTagsById(
    rows.flatMap((row) => (Array.isArray(row.channelMemes) ? row.channelMemes.map((ch) => ch?.id ?? null) : []))
  );
  return rows.map((row) => mapPoolAssetToItem(req, channelId, row, defaultPriceCoins, legacyTagsById));
}

async function buildPoolPersonalizedItems(
  req: AuthRequest,
  channelId: string,
  defaultPriceCoins: number | null,
  profile: Awaited<ReturnType<typeof TasteProfileService.getProfile>>,
  candidateLimit: number,
  limit: number
): Promise<Array<Record<string, unknown>>> {
  const rows = await loadPoolCandidates(channelId, candidateLimit, req.userId);
  const legacyTagsById = await loadLegacyTagsById(
    rows.flatMap((row) => (Array.isArray(row.channelMemes) ? row.channelMemes.map((ch) => ch?.id ?? null) : []))
  );

  const scored: ScoredItem[] = rows.map((row) => {
    const ch = Array.isArray(row.channelMemes) && row.channelMemes.length > 0 ? row.channelMemes[0] : null;
    const legacyTags = legacyTagsById.get(ch?.id ?? '');
    const tagNames =
      legacyTags && legacyTags.length > 0
        ? legacyTags.map((t) => t.name)
        : Array.isArray(row.aiAutoTagNames)
          ? row.aiAutoTagNames
          : [];
    const score = TasteProfileService.scoreMemeForUser(profile, { tagNames });
    const item = mapPoolAssetToItem(req, channelId, row, defaultPriceCoins, legacyTagsById);
    return { item, score, createdAt: row.createdAt, key: row.id, tagNames };
  });

  return pickTopItems(scored, limit);
}

function mapPoolAssetToItem(
  _req: AuthRequest,
  channelId: string,
  row: {
    id: string;
      type: string;
      fileUrl: string | null;
      durationMs: number;
      qualityScore?: number | null;
      variants?: Array<{
        format: string;
        fileUrl: string;
      status: string;
      priority: number;
      fileSizeBytes?: bigint | null;
    }>;
    createdAt: Date;
    aiAutoTitle: string | null;
    createdBy?: { id: string; displayName: string } | null;
    channelMemes?: Array<{
      id: string;
      title: string | null;
      priceCoins: number | null;
      cooldownMinutes: number | null;
      lastActivatedAt: Date | null;
    }>;
  },
  defaultPriceCoins: number | null,
  legacyTagsById: Map<string, MemeTagDto[]>
): Record<string, unknown> {
  const ch = Array.isArray(row.channelMemes) && row.channelMemes.length > 0 ? row.channelMemes[0] : null;
  const title = String(ch?.title || row.aiAutoTitle || 'Meme').slice(0, 200);
  const channelPrice = ch?.priceCoins;
  const priceCoins =
    Number.isFinite(channelPrice) && channelPrice !== null
      ? (channelPrice as number)
      : Number.isFinite(defaultPriceCoins)
        ? (defaultPriceCoins as number)
        : 100;
  const legacyTags = legacyTagsById.get(ch?.id ?? '');
  const cooldownPayload = buildCooldownPayload({
    cooldownMinutes: ch?.cooldownMinutes ?? null,
    lastActivatedAt: ch?.lastActivatedAt ?? null,
  });

  const doneVariants = Array.isArray(row.variants) ? row.variants.filter((v) => String(v.status || '') === 'done') : [];
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
    id: row.id,
    channelId,
    channelMemeId: ch?.id ?? row.id,
    memeAssetId: row.id,
    title,
    type: row.type,
    previewUrl: preview?.fileUrl ?? null,
    variants,
    fileUrl: variants[0]?.fileUrl ?? preview?.fileUrl ?? row.fileUrl ?? null,
    durationMs: row.durationMs,
    qualityScore: row.qualityScore ?? null,
    priceCoins,
    ...(cooldownPayload ?? {}),
    status: 'approved',
    deletedAt: null,
    createdAt: row.createdAt,
    createdBy: row.createdBy ? { id: row.createdBy.id, displayName: row.createdBy.displayName } : null,
    fileHash: null,
    ...(legacyTags && legacyTags.length > 0 ? { tags: legacyTags } : {}),
  };
}
