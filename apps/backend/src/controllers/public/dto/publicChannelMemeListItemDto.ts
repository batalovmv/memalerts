export type PublicChannelMemeListItemDto = {
  // Back-compat id: legacy Meme.id when available, otherwise ChannelMeme.id.
  id: string;
  channelId: string;

  // New ids (preferred)
  channelMemeId: string;
  memeAssetId: string;

  title: string;
  type: string;
  fileUrl: string | null;
  durationMs: number;
  priceCoins: number;
  activationsCount: number;
  createdAt: Date;
  createdBy: { id: string; displayName: string } | null;
};

export function toPublicChannelMemeListItemDto(
  channelId: string,
  row: {
    id: string;
    legacyMemeId: string | null;
    memeAssetId: string;
    title: string;
    priceCoins: number;
    createdAt: Date;
    memeAsset: {
      type: string;
      fileUrl: string | null;
      durationMs: number;
      createdBy?: { id: string; displayName: string } | null;
    };
    _count?: { activations: number };
  }
): PublicChannelMemeListItemDto {
  const activationsCount =
    typeof row._count?.activations === 'number' && Number.isFinite(row._count.activations)
      ? row._count.activations
      : 0;

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
    activationsCount,
    createdAt: row.createdAt,
    createdBy: row.memeAsset.createdBy
      ? { id: row.memeAsset.createdBy.id, displayName: row.memeAsset.createdBy.displayName }
      : null,
  };
}
