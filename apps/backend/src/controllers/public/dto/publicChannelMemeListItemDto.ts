export type PublicChannelMemeListItemDto = {
  // Back-compat id: legacy Meme.id when available, otherwise ChannelMeme.id.
  id: string;
  channelId: string;

  // New ids (preferred)
  channelMemeId: string;
  memeAssetId: string;

  title: string;
  type: string;
  previewUrl: string | null;
  variants: Array<{
    format: 'webm' | 'mp4';
    fileUrl: string;
    sourceType: string;
    fileSizeBytes: number | null;
  }>;
  fileUrl: string | null;
  durationMs: number;
  priceCoins: number;
  activationsCount: number;
  createdAt: Date;
  createdBy: { id: string; displayName: string } | null;
};

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
      variants?: Array<{
        format: string;
        fileUrl: string;
        status: string;
        priority: number;
        fileSizeBytes?: bigint | null;
      }>;
      createdBy?: { id: string; displayName: string } | null;
    };
    _count?: { activations: number };
  }
): PublicChannelMemeListItemDto {
  const activationsCount =
    typeof row._count?.activations === 'number' && Number.isFinite(row._count.activations)
      ? row._count.activations
      : 0;

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
    activationsCount,
    createdAt: row.createdAt,
    createdBy: row.memeAsset.createdBy
      ? { id: row.memeAsset.createdBy.id, displayName: row.memeAsset.createdBy.displayName }
      : null,
  };
}
