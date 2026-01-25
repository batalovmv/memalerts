import type { AudioNormStatus, MemeAssetStatus, MemeStatus, MemeType, SubmissionAiStatus } from './common';

export interface Tag {
  id: string;
  name: string;
}

export interface MemeVariant {
  format: 'webm' | 'mp4';
  fileUrl: string;
  sourceType: string;
  fileSizeBytes: number | null;
}

export interface Meme {
  id: string;
  /**
   * New canonical identifier for channel listings.
   * Backend may still return legacy `id` for compatibility, but will include this field.
   */
  channelMemeId?: string;
  /**
   * Back-compat identifier for legacy endpoints.
   */
  legacyMemeId?: string;
  title: string;
  type: MemeType;
  /**
   * Optional multi-format variants (preferred playback order).
   * Backend may omit on older versions.
   */
  variants?: MemeVariant[];
  /**
   * Preview URL for meme cards (small, muted).
   */
  previewUrl?: string | null;
  fileUrl: string;
  playFileUrl?: string | null;
  fileHash?: string | null;
  /**
   * Optional link to the underlying MemeAsset (when backend includes it in streamer/channel DTOs).
   * Useful for AI cooldown scope and dedup.
   */
  memeAssetId?: string | null;
  priceCoins: number;
  /**
   * Dynamic pricing (optional; shown when channel enables smart pricing).
   * basePriceCoins = streamer-set price; dynamicPriceCoins = current price.
   */
  basePriceCoins?: number;
  dynamicPriceCoins?: number;
  priceMultiplier?: number;
  priceTrend?: 'rising' | 'falling' | 'stable';
  durationMs: number;
  /**
   * Smart cooldown (optional; channel-wide anti-spam).
   */
  cooldownMinutes?: number;
  cooldownSecondsRemaining?: number;
  cooldownUntil?: string | null;
  activationsCount?: number;
  _count?: { activations?: number };
  status?: MemeStatus;
  channelId?: string;
  deletedAt?: string | null;
  tags?: Array<{ tag: Tag }>;
  /**
   * Optional AI enrichment for channel memes (only when requesting /channels/memes/search with includeAi=1
   * and the current user has access).
   */
  aiAutoDescription?: string | null;
  aiAutoTagNames?: string[] | null;
  /**
   * Optional AI pipeline status for channel memes (additive; backend may omit).
   */
  aiStatus?: SubmissionAiStatus | null;
  /**
   * Optional AI title proposal (additive; backend may omit).
   */
  aiAutoTitle?: string | null;
  qualityScore?: number | null;
  /**
   * Viewer-specific flags (optional; only when authenticated).
   */
  isFavorite?: boolean;
  isHidden?: boolean;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: {
    id: string;
    displayName: string;
    channel?: {
      slug: string;
    };
  };
}

export interface MemeAsset {
  id: string;
  type: MemeType;
  fileUrl: string;
  playFileUrl?: string | null;
  fileHash: string;
  durationMs?: number | null;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  status: MemeAssetStatus;
  hiddenAt?: string | null;
  hiddenBy?: string | null;
  quarantinedAt?: string | null;
  quarantinedBy?: string | null;
  quarantineReason?: string | null;
  deletedAt?: string | null;
  aiStatus?: 'pending' | 'done';
  aiAutoTitle?: string | null;
  aiAutoTagNamesJson?: string[] | null;
  aiAutoDescription?: string | null;
  aiSearchText?: string | null;
  aiCompletedAt?: string | null;
  qualityScore?: number | null;
  audioNormStatus?: AudioNormStatus;
  audioNormRetryCount?: number;
  audioNormLastTriedAt?: string | null;
  usageCount?: number;
  channelCount?: number;
  createdAt: string;
  updatedAt?: string;
}
