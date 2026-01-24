import type { Request } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { parseQueryBool } from '../../shared/utils/queryParsers.js';

// Canonical list item for "channel memes listing" used by:
// - GET /channels/:slug/memes
// - GET /channels/memes/search?channelId=... (in channel listing mode)
//
// IMPORTANT:
// - Channel-scoped visibility is based on ChannelMeme (approved + deletedAt=null).
// - fileUrl is stored in DB as either an absolute URL (S3/CDN) or a relative "/uploads/..." path (local).
//   This DTO intentionally returns `fileUrl` as-is (opaque public path).

export type MemeVariantDto = {
  format: 'webm' | 'mp4';
  fileUrl: string;
  sourceType: string;
  fileSizeBytes: number | null;
};

export type MemeTagDto = {
  tag: {
    id: string;
    name: string;
  };
};

export type ChannelMemeListItemDto = {
  // Back-compat id: legacy Meme.id when available, otherwise ChannelMeme.id.
  id: string;
  channelId: string;

  // New ids (preferred for new clients)
  channelMemeId: string;
  memeAssetId: string;

  title: string;
  type: string;
  previewUrl: string | null;
  variants: MemeVariantDto[];
  fileUrl: string | null;
  durationMs: number;
  priceCoins: number;
  status: string;
  deletedAt: null; // always null in listing responses (by filter)
  createdAt: Date;
  createdBy: { id: string; displayName: string } | null;
  tags?: MemeTagDto[];

  // Optional internal-ish dedup key (SHA-256 of bytes). Returned only for owner/admin when requested.
  fileHash: string | null;

  // Optional hidden AI fields (returned only for owner/admin when explicitly requested).
  aiAutoDescription?: string | null;
  aiAutoTagNames?: string[] | null;
  aiStatus?: string | null;
  aiAutoTitle?: string | null;
};

export function canReturnFileHash(req: Request, channelId: string): boolean {
  const query = (req.query as Record<string, unknown>) ?? {};
  const wants = parseQueryBool(query.includeFileHash);
  if (!wants) return false;
  const auth = req as AuthRequest;
  if (!auth.userId) return false;
  if (auth.userRole === 'admin') return true;
  // Streamer is scoped to a channel in JWT.
  return String(auth.channelId || '') === String(channelId);
}

export function canReturnAiFields(req: Request, channelId: string): boolean {
  const query = (req.query as Record<string, unknown>) ?? {};
  const wants = parseQueryBool(query.includeAi);
  if (!wants) return false;
  const auth = req as AuthRequest;
  if (!auth.userId) return false;
  if (auth.userRole === 'admin') return true;
  // Streamer is scoped to a channel in JWT.
  return String(auth.channelId || '') === String(channelId);
}

export function getSourceType(format: 'webm' | 'mp4' | 'preview'): string {
  switch (format) {
    case 'preview':
      return 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
    case 'webm':
      return 'video/webm; codecs="vp9, opus"';
    case 'mp4':
      return 'video/mp4; codecs="avc1.4d401f, mp4a.40.2"';
  }
}

export function toChannelMemeListItemDto(
  req: Request,
  channelId: string,
  row: {
    id: string;
    legacyMemeId: string | null;
    memeAssetId: string;
    title: string;
    priceCoins: number;
    status: string;
    createdAt: Date;
    memeAsset: {
      type: string;
      fileUrl: string | null;
      fileHash?: string | null;
      durationMs: number;
      variants?: Array<{
        format: string;
        fileUrl: string;
        status: string;
        priority: number;
        fileSizeBytes?: bigint | null;
      }>;
      createdBy?: { id: string; displayName: string } | null;
      aiStatus?: string | null;
      aiAutoTitle?: string | null;
    };
    aiAutoDescription?: string | null;
    aiAutoTagNamesJson?: unknown | null;
  }
): ChannelMemeListItemDto {
  const exposeHash = canReturnFileHash(req, channelId);
  const exposeAi = canReturnAiFields(req, channelId);
  const doneVariants = Array.isArray(row.memeAsset.variants)
    ? row.memeAsset.variants.filter((v) => String(v.status || '') === 'done')
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
    id: row.legacyMemeId ?? row.id,
    channelId,
    channelMemeId: row.id,
    memeAssetId: row.memeAssetId,
    title: row.title,
    type: row.memeAsset.type,
    previewUrl: preview?.fileUrl ?? null,
    variants,
    fileUrl: variants[0]?.fileUrl ?? preview?.fileUrl ?? row.memeAsset.fileUrl ?? null,
    durationMs: row.memeAsset.durationMs,
    priceCoins: row.priceCoins,
    status: row.status,
    deletedAt: null,
    createdAt: row.createdAt,
    createdBy: row.memeAsset.createdBy
      ? { id: row.memeAsset.createdBy.id, displayName: row.memeAsset.createdBy.displayName }
      : null,
    fileHash: exposeHash ? (row.memeAsset.fileHash ?? null) : null,
    ...(exposeAi
      ? {
          aiAutoDescription: row.aiAutoDescription ?? null,
          aiAutoTagNames: Array.isArray(row.aiAutoTagNamesJson) ? (row.aiAutoTagNamesJson as string[]) : null,
          aiStatus: row.memeAsset.aiStatus ?? null,
          aiAutoTitle: row.memeAsset.aiAutoTitle ?? null,
        }
      : {}),
  };
}

export async function loadLegacyTagsById(
  legacyIds: Array<string | null | undefined>
): Promise<Map<string, MemeTagDto[]>> {
  const ids = Array.from(
    new Set(
      legacyIds
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .map((id) => id.trim())
    )
  );
  if (ids.length === 0) return new Map();

  try {
    const rows = await prisma.meme.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        tags: {
          select: {
            tag: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    return new Map(
      rows.map((row) => [row.id, Array.isArray(row.tags) ? (row.tags as MemeTagDto[]) : []])
    );
  } catch {
    return new Map();
  }
}
