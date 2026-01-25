import type { AuthRequest } from '../../../middleware/auth.js';
import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import type { CursorFieldSchema } from '../../../utils/pagination.js';
import type { PaginationError } from '../../../utils/pagination.js';
import type { toPublicChannelMemeListItemDto } from '../dto/publicChannelMemeListItemDto.js';
import { buildCooldownPayload } from '../../viewer/channelMemeListDto.js';
import { safeDecodeCursor } from '../../../utils/pagination.js';

export const CURSOR_SENTINELS = new Set(['', 'null', 'undefined', 'start', 'initial']);
export const LEGACY_DEFAULT_LIMIT = 30;

export type ChannelOwner = { id: string; displayName: string; profileImageUrl: string | null };

export type PublicChannelResponse = {
  id: string;
  slug: string;
  name: string;
  coinIconUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  rewardTitle: string | null;
  rewardOnlyWhenLive: boolean;
  submissionRewardCoins: number;
  submissionRewardOnlyWhenLive: boolean;
  submissionsEnabled: boolean;
  submissionsOnlyWhenLive: boolean;
  owner: ChannelOwner | null;
  stats: { memesCount: number; usersCount: number };
  memes?: PublicChannelMemeListItem[];
  memesPage?: { limit: number; offset: number; returned: number; total: number };
};

export type MemeAssetPoolRow = Prisma.MemeAssetGetPayload<{
  select: {
    id: true;
    type: true;
    fileUrl: true;
    durationMs: true;
    qualityScore: true;
    variants: {
      select: {
        format: true;
        fileUrl: true;
        status: true;
        priority: true;
        fileSizeBytes: true;
      };
    };
    createdAt: true;
    aiAutoTitle: true;
    aiAutoTagNamesJson: true;
    createdBy: { select: { id: true; displayName: true } };
    channelMemes: {
      where: { channelId: string; status: 'approved'; deletedAt: null };
      take: 1;
      orderBy: { createdAt: 'desc' };
      select: {
        id: true;
        title: true;
        priceCoins: true;
        legacyMemeId: true;
        cooldownMinutes: true;
        lastActivatedAt: true;
        _count: {
          select: {
            activations: {
              where: { status: 'done' };
            };
          };
        };
      };
    };
  };
}>;

export type PublicChannelMemeListItem = ReturnType<typeof toPublicChannelMemeListItemDto>;

export type CursorDictionary = Record<string, unknown>;

export type ListOrderings = {
  memeAsset: Prisma.MemeAssetOrderByWithRelationInput[];
  channelMeme: Prisma.ChannelMemeOrderByWithRelationInput[];
};

export type PublicChannelMetaQuery = {
  includeMemes?: string;
  limit?: string;
  offset?: string;
  sortBy?: 'priceCoins' | 'createdAt' | string;
  sortOrder?: 'asc' | 'desc' | string;
};

export type PublicChannelMemesQuery = {
  limit?: string;
  offset?: string;
  sortBy?: 'priceCoins' | 'createdAt' | string;
  sortOrder?: 'asc' | 'desc' | string;
  cursor?: string;
  includeTotal?: string;
};

export type PublicChannelSearchQuery = {
  q?: string;
  tags?: string;
  limit?: string;
  offset?: string;
  sortBy?: 'priceCoins' | 'createdAt' | string;
  sortOrder?: 'asc' | 'desc' | string;
  cursor?: string;
};

export function buildChannelPoolWhere(channelId: string): Prisma.MemeAssetWhereInput {
  return {
    poolVisibility: 'visible',
    purgedAt: null,
    fileUrl: { not: null },
    NOT: {
      channelMemes: {
        some: {
          channelId,
          OR: [{ status: { not: 'approved' } }, { deletedAt: { not: null } }],
        },
      },
    },
  };
}

export function buildChannelMemeWhere(channelId: string): Prisma.ChannelMemeWhereInput {
  return {
    channelId,
    status: 'approved',
    deletedAt: null,
  };
}

export function buildListOrderings(sortBy: 'priceCoins' | 'createdAt', sortOrder: Prisma.SortOrder): ListOrderings {
  const priceOrderForMemeAsset: Prisma.MemeAssetOrderByWithRelationInput[] = [
    { createdAt: 'desc' as const },
    { id: 'desc' as const },
  ];
  const dateOrderForMemeAsset: Prisma.MemeAssetOrderByWithRelationInput[] = [
    { createdAt: sortOrder },
    { id: 'desc' as const },
  ];

  const priceOrderForChannelMeme: Prisma.ChannelMemeOrderByWithRelationInput[] = [
    { priceCoins: sortOrder },
    { createdAt: 'desc' as const },
    { id: 'desc' as const },
  ];
  const dateOrderForChannelMeme: Prisma.ChannelMemeOrderByWithRelationInput[] = [
    { createdAt: sortOrder },
    { id: 'desc' as const },
  ];

  return {
    memeAsset: sortBy === 'priceCoins' ? priceOrderForMemeAsset : dateOrderForMemeAsset,
    channelMeme: sortBy === 'priceCoins' ? priceOrderForChannelMeme : dateOrderForChannelMeme,
  };
}

export function respondPaginationError(res: Response, error: PaginationError) {
  return res.status(error.status).json({
    errorCode: error.errorCode,
    error: error.message,
    details: error.details,
  });
}

export function parseLegacyOffset(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

export function shouldUseCursorMode(req: AuthRequest): boolean {
  const query = req?.query ?? {};
  if (Object.prototype.hasOwnProperty.call(query, 'cursor')) return true;
  const paginationMode = String(query.pagination || query.pageMode || '')
    .trim()
    .toLowerCase();
  return paginationMode === 'cursor';
}

export function buildCursorSchemaForSort(sortBy: string, sortOrder: 'asc' | 'desc'): CursorFieldSchema[] {
  if (sortBy === 'priceCoins') {
    return [
      { key: 'priceCoins', direction: sortOrder, type: 'number' },
      { key: 'createdAt', direction: 'desc', type: 'date' },
      { key: 'id', direction: 'desc', type: 'string' },
    ];
  }
  return [
    { key: 'createdAt', direction: sortOrder === 'asc' ? 'asc' : 'desc', type: 'date' },
    { key: 'id', direction: 'desc', type: 'string' },
  ];
}

export function decodeCursorParam(value: unknown, schema: CursorFieldSchema[]): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return safeDecodeCursor(value, schema);
  const trimmed = value.trim().toLowerCase();
  if (CURSOR_SENTINELS.has(trimmed)) return null;
  return safeDecodeCursor(value, schema);
}

export function mapPoolAssetsToDtos(
  rows: MemeAssetPoolRow[],
  channelId: string,
  defaultPriceCoins: number
): PublicChannelMemeListItem[] {
  return rows.map((r) => {
    const ch = Array.isArray(r.channelMemes) && r.channelMemes.length > 0 ? r.channelMemes[0] : null;
    const title = String(ch?.title || r.aiAutoTitle || 'Meme').slice(0, 200);
    const channelPrice = ch?.priceCoins;
    const priceCoins = Number.isFinite(channelPrice) ? (channelPrice as number) : defaultPriceCoins;
    const activationsCount =
      typeof ch?._count?.activations === 'number' && Number.isFinite(ch._count.activations)
        ? ch._count.activations
        : 0;
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
    const aiAutoTagNames = Array.isArray(r.aiAutoTagNamesJson)
      ? (r.aiAutoTagNamesJson as unknown[])
          .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
          .map((tag) => tag.trim())
      : null;
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
      priceCoins,
      ...(cooldownPayload ?? {}),
      activationsCount,
      createdAt: r.createdAt,
      createdBy: r.createdBy ? { id: r.createdBy.id, displayName: r.createdBy.displayName } : null,
      qualityScore: r.qualityScore ?? null,
      ...(aiAutoTagNames && aiAutoTagNames.length > 0 ? { aiAutoTagNames } : {}),
    };
  });
}

function getSourceType(format: 'webm' | 'mp4' | 'preview'): string {
  switch (format) {
    case 'preview':
      return 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
    case 'webm':
      return 'video/webm; codecs="vp9, opus"';
    case 'mp4':
      return 'video/mp4; codecs="avc1.4d401f, mp4a.40.2"';
  }
}
