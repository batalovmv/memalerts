import type { MemeDetail, MemeListItem, MemeVariant, Tag } from '@memalerts/api-contracts';

interface DbChannelMeme {
  id: string;
  title: string;
  priceCoins: number;
  cooldownMinutes: number | null;
  lastActivatedAt: Date | null;
  status: string;
  createdAt: Date;
  memeAsset: {
    id: string;
    type: string;
    fileUrl: string;
    durationMs: number;
    qualityScore: number | null;
    aiAutoDescription: string | null;
    aiAutoTagNames: string[];
    variants: Array<{
      format: string;
      fileUrl: string;
      status: string;
      priority: number;
      fileSizeBytes: bigint | null;
    }>;
    createdBy: {
      id: string;
      displayName: string;
    } | null;
  };
  tags: Array<{
    tag: {
      id: string;
      name: string;
    };
  }>;
  _count?: {
    activations: number;
  };
}

function getSourceType(format: string): string {
  switch (format) {
    case 'preview':
      return 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
    case 'webm':
      return 'video/webm; codecs="vp9, opus"';
    case 'mp4':
      return 'video/mp4; codecs="avc1.4d401f, mp4a.40.2"';
    default:
      return 'video/mp4';
  }
}

function mapVariants(variants: DbChannelMeme['memeAsset']['variants']): MemeVariant[] {
  return variants
    .filter((variant) => variant.status === 'done')
    .sort((a, b) => a.priority - b.priority)
    .map((variant) => ({
      format: variant.format as MemeVariant['format'],
      fileUrl: variant.fileUrl,
      sourceType: getSourceType(variant.format),
      fileSizeBytes: variant.fileSizeBytes ? Number(variant.fileSizeBytes) : null,
    }));
}

function mapTags(tags: DbChannelMeme['tags']): Tag[] {
  return tags.map((tagRel) => ({
    id: tagRel.tag.id,
    name: tagRel.tag.name,
  }));
}

function getPreviewUrl(variants: MemeVariant[]): string | null {
  const preview = variants.find((variant) => variant.format === 'preview');
  return preview?.fileUrl ?? null;
}

function getPrimaryFileUrl(variants: MemeVariant[], fallbackUrl: string): string {
  const playable = variants.filter((variant) => variant.format !== 'preview');
  return playable[0]?.fileUrl ?? fallbackUrl;
}

export function toMemeListItem(db: DbChannelMeme): MemeListItem {
  const variants = mapVariants(db.memeAsset.variants);

  return {
    id: db.id,
    title: db.title,
    type: db.memeAsset.type as MemeListItem['type'],
    fileUrl: getPrimaryFileUrl(variants, db.memeAsset.fileUrl),
    previewUrl: getPreviewUrl(variants),
    variants: variants.filter((variant) => variant.format !== 'preview'),
    priceCoins: db.priceCoins,
    durationMs: db.memeAsset.durationMs,
    activationsCount: db._count?.activations ?? 0,
    createdAt: db.createdAt.toISOString(),
  };
}

export function toMemeDetail(db: DbChannelMeme): MemeDetail {
  const listItem = toMemeListItem(db);

  let cooldownSecondsRemaining = 0;
  let cooldownUntil: string | null = null;

  if (db.cooldownMinutes && db.lastActivatedAt) {
    const cooldownEnd = new Date(db.lastActivatedAt.getTime() + db.cooldownMinutes * 60 * 1000);
    const remaining = Math.ceil((cooldownEnd.getTime() - Date.now()) / 1000);
    if (remaining > 0) {
      cooldownSecondsRemaining = remaining;
      cooldownUntil = cooldownEnd.toISOString();
    }
  }

  return {
    ...listItem,
    status: db.status as MemeDetail['status'],
    cooldownMinutes: db.cooldownMinutes ?? undefined,
    cooldownSecondsRemaining: cooldownSecondsRemaining || undefined,
    cooldownUntil,
    tags: mapTags(db.tags),
    aiAutoDescription: db.memeAsset.aiAutoDescription,
    aiAutoTagNames: db.memeAsset.aiAutoTagNames,
    qualityScore: db.memeAsset.qualityScore,
    createdBy: db.memeAsset.createdBy,
  };
}
