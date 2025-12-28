import type { Request } from 'express';

// Canonical list item for "channel memes listing" used by:
// - GET /channels/:slug/memes
// - GET /channels/memes/search?channelId=... (in channel listing mode)
//
// IMPORTANT:
// - Channel-scoped visibility is based on ChannelMeme (approved + deletedAt=null).
// - fileUrl is stored in DB as either an absolute URL (S3/CDN) or a relative "/uploads/..." path (local).
//   This DTO intentionally returns `fileUrl` as-is (opaque public path).

export type ChannelMemeListItemDto = {
  // Back-compat id: legacy Meme.id when available, otherwise ChannelMeme.id.
  id: string;
  channelId: string;

  // New ids (preferred for new clients)
  channelMemeId: string;
  memeAssetId: string;

  title: string;
  type: string;
  fileUrl: string | null;
  durationMs: number;
  priceCoins: number;
  status: string;
  deletedAt: null; // always null in listing responses (by filter)
  createdAt: Date;
  createdBy: { id: string; displayName: string } | null;

  // Optional internal-ish dedup key (SHA-256 of bytes). Returned only for owner/admin when requested.
  fileHash: string | null;
};

export function canReturnFileHash(req: any, channelId: string): boolean {
  const flag = String((req?.query as any)?.includeFileHash ?? '').toLowerCase();
  const wants = flag === '1' || flag === 'true' || flag === 'yes' || flag === 'on';
  if (!wants) return false;
  if (!req?.userId) return false;
  if (req?.userRole === 'admin') return true;
  // Streamer is scoped to a channel in JWT.
  return String(req?.channelId || '') === String(channelId);
}

export function toChannelMemeListItemDto(
  req: Request | any,
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
      createdBy?: { id: string; displayName: string } | null;
    };
  }
): ChannelMemeListItemDto {
  const exposeHash = canReturnFileHash(req, channelId);
  return {
    id: row.legacyMemeId ?? row.id,
    channelId,
    channelMemeId: row.id,
    memeAssetId: row.memeAssetId,
    title: row.title,
    type: row.memeAsset.type,
    fileUrl: row.memeAsset.fileUrl ?? null,
    durationMs: row.memeAsset.durationMs,
    priceCoins: row.priceCoins,
    status: row.status,
    deletedAt: null,
    createdAt: row.createdAt,
    createdBy: row.memeAsset.createdBy ? { id: row.memeAsset.createdBy.id, displayName: row.memeAsset.createdBy.displayName } : null,
    fileHash: exposeHash ? (row.memeAsset.fileHash ?? null) : null,
  };
}


