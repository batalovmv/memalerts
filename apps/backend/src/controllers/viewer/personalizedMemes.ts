import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { TasteProfileService } from '../../services/taste/TasteProfileService.js';
import { HybridRecommender } from '../../services/recommendations/HybridRecommender.js';
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

function calculateFreshnessBoost(createdAt: Date): number {
  const createdAtMs = createdAt?.getTime?.();
  if (!Number.isFinite(createdAtMs)) return 1.0;

  const daysSinceCreation = (Date.now() - createdAtMs) / (1000 * 60 * 60 * 24);

  if (daysSinceCreation < 1) return 2.0; // Сегодня — двойной буст
  if (daysSinceCreation < 3) return 1.7; // 1-3 дня — 1.7x
  if (daysSinceCreation < 7) return 1.4; // Неделя — 1.4x
  if (daysSinceCreation < 14) return 1.2; // 2 недели — 1.2x
  if (daysSinceCreation < 30) return 1.1; // Месяц — 1.1x
  return 1.0; // Старше — без буста
}

function normalizeByPopularity(score: number, activationCount: number): number {
  const popularityFactor = Math.log10(activationCount + 10);
  const baseFactor = Math.log10(10); // = 1

  return score / (popularityFactor / baseFactor);
}

function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function mixExploration<T extends { id: string }>(
  personalizedMemes: T[],
  allCandidates: T[],
  limit: number,
  explorationRatio: number = 0.1
): T[] {
  const explorationCount = Math.max(1, Math.floor(limit * explorationRatio));
  const exploitationCount = limit - explorationCount;

  const exploitation = personalizedMemes.slice(0, exploitationCount);
  const exploitationIds = new Set(exploitation.map((m) => m.id));

  const unseenCandidates = allCandidates.filter((m) => !exploitationIds.has(m.id));
  const exploration = shuffleArray(unseenCandidates).slice(0, explorationCount);

  return [...exploitation, ...exploration];
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

const CHANNEL_MEME_LIST_SELECT = {
  id: true,
  memeAssetId: true,
  _count: { select: { activations: true } },
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
};

function applyChannelMemeVisibility(
  where: Prisma.ChannelMemeWhereInput,
  channelId: string,
  userId?: string | null
): void {
  const visibility = buildChannelMemeVisibilityFilter({ channelId, userId: userId ?? null, includeUserHidden: true });
  if (visibility) {
    if (!where.AND) where.AND = [visibility];
    else if (Array.isArray(where.AND)) where.AND.push(visibility);
    else where.AND = [where.AND, visibility];
  }
}

async function loadChannelCandidates(channelId: string, limit: number, userId?: string | null) {
  const where: Prisma.ChannelMemeWhereInput = { channelId, status: 'approved', deletedAt: null };
  applyChannelMemeVisibility(where, channelId, userId);
  return prisma.channelMeme.findMany({
    where,
    select: CHANNEL_MEME_LIST_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
}

async function loadChannelCandidatesByIds(channelId: string, ids: string[], userId?: string | null) {
  const uniqueIds = Array.from(
    new Set(ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))
  );
  if (uniqueIds.length === 0) return [];

  const where: Prisma.ChannelMemeWhereInput = {
    channelId,
    status: 'approved',
    deletedAt: null,
    id: { in: uniqueIds },
  };
  applyChannelMemeVisibility(where, channelId, userId);

  return prisma.channelMeme.findMany({
    where,
    select: CHANNEL_MEME_LIST_SELECT,
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
        select: {
          id: true,
          title: true,
          priceCoins: true,
          cooldownMinutes: true,
          lastActivatedAt: true,
          _count: { select: { activations: true } },
        },
      },
    },
  });
}

function hasItemId(
  item: ChannelMemeListItemDto | Record<string, unknown>
): item is { id: string } & (ChannelMemeListItemDto | Record<string, unknown>) {
  return typeof (item as { id?: unknown }).id === 'string';
}

function pickTopItems(
  scored: ScoredItem[],
  limit: number,
  allCandidates: Array<ChannelMemeListItemDto | Record<string, unknown>>,
  explorationRatio: number
): Array<ChannelMemeListItemDto | Record<string, unknown>> {
  const sorted = scored
    .slice()
    .sort((a, b) => b.score - a.score || b.createdAt.getTime() - a.createdAt.getTime());

  const positive = sorted.filter((entry) => entry.score > 0);
  const diversified = diversifyResults(positive, limit);

  const diversifiedItems = diversified.map((entry) => entry.item).filter(hasItemId);
  const explorationPool = allCandidates.filter(hasItemId);
  const explorationMix = mixExploration(diversifiedItems, explorationPool, limit, explorationRatio);

  const selected: Array<ChannelMemeListItemDto | Record<string, unknown>> = [...explorationMix];
  const used = new Set<string>(explorationMix.map((item) => item.id));

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
  const explorationRaw = parseFloat(String(req.query.exploration ?? ''));
  const limit = clampInt(Number.isFinite(limitRaw) ? limitRaw : 20, 1, 50, 20);
  const candidateLimit = clampInt(
    Number.isFinite(candidateRaw) ? candidateRaw : Math.max(100, limit * 5),
    limit,
    500,
    Math.max(100, limit * 5)
  );
  const explorationRatio = Math.min(0.3, Math.max(0, Number.isFinite(explorationRaw) ? explorationRaw : 0.1));

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
    const items = await buildPoolPersonalizedItems(
      req,
      channel.id,
      channel.defaultPriceCoins,
      profile,
      candidateLimit,
      limit,
      explorationRatio
    );
    const withState = await attachViewerState(items as Array<Record<string, unknown>>);
    return res.json({ items: withState, profileReady: true, totalActivations, mode: 'personalized' });
  }

  const items = await buildChannelPersonalizedItems(req, channel.id, limit, explorationRatio);
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
  limit: number,
  explorationRatio: number = 0.1
): Promise<ChannelMemeListItemDto[]> {
  const recommendedIds = await HybridRecommender.getRecommendations({
    userId: req.userId!,
    channelId,
    limit,
    config: {
      contentWeight: 0.5,
      collaborativeWeight: 0.3,
      freshnessWeight: 0.2,
      explorationRatio,
    },
  });

  const rows = await loadChannelCandidatesByIds(channelId, recommendedIds, req.userId);
  const legacyTagsById = await loadLegacyTagsById(rows.map((r) => r.id));
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  const orderedRows = recommendedIds
    .map((id) => rowsById.get(id))
    .filter((row): row is (typeof rows)[number] => Boolean(row));

  return orderedRows.map((row) => {
    const item = toChannelMemeListItemDto(req, channelId, row);
    const tags = legacyTagsById.get(row.id);
    return tags && tags.length > 0 ? ({ ...item, tags } as ChannelMemeListItemDto) : item;
  });
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
  limit: number,
  explorationRatio: number = 0.1
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
    const baseScore = TasteProfileService.scoreMemeForUser(profile, { tagNames });
    const freshnessBoost = calculateFreshnessBoost(row.createdAt);
    const activationCount = ch?._count?.activations ?? 0;
    const score = normalizeByPopularity(baseScore * freshnessBoost, activationCount);
    const item = mapPoolAssetToItem(req, channelId, row, defaultPriceCoins, legacyTagsById);
    return { item, score, createdAt: row.createdAt, key: row.id, tagNames };
  });

  const allCandidates = scored.map((entry) => entry.item);
  return pickTopItems(scored, limit, allCandidates, explorationRatio);
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
