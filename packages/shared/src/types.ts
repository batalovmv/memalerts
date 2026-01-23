export type UserRole = 'viewer' | 'streamer' | 'admin';

export type MemeCatalogMode = 'channel' | 'pool_all';

export type StorageProvider = 'local' | 's3';

export type BotProvider = 'twitch' | 'youtube' | 'vkvideo' | 'trovo' | 'kick';

export type SubmissionSourceKind = 'upload' | 'url' | 'pool';

export type MemeAssetStatus = 'active' | 'hidden' | 'quarantined' | 'deleted';

export type AudioNormStatus = 'pending' | 'processing' | 'done' | 'failed' | 'failed_final';

export interface CreditsEntry {
  displayName: string;
  amount?: number;
  message?: string;
}

export interface CreditsState {
  donors: CreditsEntry[];
  chatters: CreditsEntry[];
}

export interface CreditsStyleJson {
  backgroundColor?: string;
  textColor?: string;
  fontSize?: number;
  fontFamily?: string;
  [key: string]: unknown;
}

export interface BotIntegrationSettings {
  provider: BotProvider;
  enabled: boolean;
  useDefaultBot: boolean;
  channelUrl?: string | null;
}

export type EntitlementType = 'custom_bot' | 'extended_overlay' | 'priority_ai';

export interface ChannelEntitlement {
  id: string;
  channelId: string;
  type: EntitlementType;
  grantedBy: string;
  grantedAt: string;
  expiresAt?: string | null;
}

export interface GlobalModerator {
  id: string;
  userId: string;
  user: {
    id: string;
    displayName: string;
    profileImageUrl?: string | null;
  };
  grantedBy: string;
  grantedAt: string;
}

export interface PendingCoinGrant {
  id: string;
  provider: string;
  externalAccountId: string;
  coins: number;
  reason: string;
  createdAt: string;
}

export interface Wallet {
  id: string;
  userId: string;
  channelId: string;
  balance: number;
  updatedAt?: string;
}

export interface Channel {
  id: string;
  slug: string;
  name: string;
  /**
   * Which meme catalog is shown on the public channel page.
   * - channel: only channel-approved memes (ChannelMeme)
   * - pool_all: full global pool (MemeAsset); activation requires channelSlug/channelId context
   */
  memeCatalogMode?: MemeCatalogMode;
  /**
   * Twitch broadcaster id if the channel is linked to Twitch.
   * When null/undefined, Twitch-only features must be disabled in UI.
   */
  twitchChannelId?: string | null;
  /**
   * Reward coins for approved submissions, split by source kind (upload/url vs pool).
   * Back-compat: older backend may only provide `submissionRewardCoins`.
   */
  submissionRewardCoinsUpload?: number;
  submissionRewardCoinsPool?: number;
  submissionRewardCoins?: number;
  overlayStyleJson?: string | null;
  creditsStyleJson?: string | null;
  botIntegrations?: BotIntegrationSettings[];
  twitchAutoRewardsJson?: TwitchAutoRewardsV1 | null;
  kickAutoRewardsJson?: KickAutoRewardsV1 | null;
  trovoAutoRewardsJson?: TrovoAutoRewardsV1 | null;
  vkvideoAutoRewardsJson?: VkVideoAutoRewardsV1 | null;
  youtubeAutoRewardsJson?: YouTubeAutoRewardsV1 | null;
}

export type ExternalAccountProvider =
  | 'twitch'
  | 'youtube'
  | 'vk'
  | 'vkvideo'
  | 'vkplay'
  | 'kick'
  | 'trovo'
  | 'boosty'
  | 'discord'
  | string;

export interface ExternalAccount {
  id: string;
  provider: ExternalAccountProvider;
  /**
   * Provider-specific account identifier. Name varies across backends; keep flexible.
   */
  providerAccountId?: string | null;
  providerUserId?: string | null;
  login?: string | null;
  displayName?: string | null;
  profileImageUrl?: string | null;
  profileUrl?: string | null;
  linkedAt?: string;
  lastUsedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface User {
  id: string;
  displayName: string;
  profileImageUrl?: string | null;
  role: UserRole;
  /**
   * Additive permissions flag (does NOT change User.role).
   * When true, user can access global pool moderation endpoints.
   *
   * NOTE: optional for backward compatibility with older backends.
   */
  isGlobalModerator?: boolean;
  channelId: string | null;
  channel?: Channel;
  wallets?: Wallet[];
  externalAccounts?: ExternalAccount[];
  pendingCoinGrants?: PendingCoinGrant[];
}

export type MemeType = 'image' | 'gif' | 'video' | 'audio';

// Backends evolved from legacy active/inactive to channel-scoped moderation statuses.
// Keep the union broad for back-compat across endpoints.
export type MemeStatus =
  | 'active'
  | 'inactive'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'disabled'
  | 'deleted';

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
  durationMs: number;
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

export interface MemeVariant {
  format: 'webm' | 'mp4';
  fileUrl: string;
  sourceType: string;
  fileSizeBytes: number | null;
}

export type SubmissionStatus = 'pending' | 'needs_changes' | 'approved' | 'rejected';

export interface Tag {
  id: string;
  name: string;
}

export type SubmissionAiStatus = 'pending' | 'processing' | 'done' | 'failed' | 'failed_final';
export type SubmissionAiDecision = 'low' | 'medium' | 'high';

export interface Submission {
  id: string;
  title: string;
  type: MemeType;
  fileUrlTemp: string;
  /**
   * SHA-256 hash for dedup/linking with MemeAsset/quarantine.
   * Optional for backward compatibility with older backends/endpoints.
   */
  fileHash?: string | null;
  /**
   * Best-effort media duration (ms). Optional for backward compatibility.
   */
  durationMs?: number | null;
  /**
   * Best-effort upload metadata. Optional.
   */
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  sourceUrl?: string | null;
  notes: string | null;
  status: SubmissionStatus;
  sourceKind?: SubmissionSourceKind;
  memeAssetId?: string | null;
  moderatorNotes?: string | null;
  revision?: number; // number of resubmits after "needs_changes" (0..2)
  tags?: Array<{ tag: Tag }>;
  /**
   * Async AI moderation fields (may be missing if backend doesn't include them in this endpoint).
   */
  aiStatus?: SubmissionAiStatus | null;
  aiDecision?: SubmissionAiDecision | null;
  aiRiskScore?: number | null; // 0..1
  aiLabelsJson?: string[] | null;
  aiTranscript?: string | null;
  aiAutoTagNamesJson?: string[] | null;
  aiAutoDescription?: string | null;
  aiModelVersionsJson?: Record<string, unknown> | null;
  aiCompletedAt?: string | null;
  aiLastTriedAt?: string | null;
  aiRetryCount?: number | null;
  aiNextRetryAt?: string | null;
  aiError?: string | null;
  aiLockExpiresAt?: string | null;
  aiProcessingStartedAt?: string | null;
  submitter: {
    id: string;
    displayName: string;
  };
  createdAt: string;
  updatedAt?: string;
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
  audioNormStatus?: AudioNormStatus;
  audioNormRetryCount?: number;
  audioNormLastTriedAt?: string | null;
  usageCount?: number;
  channelCount?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface ApiError {
  message: string;
  error?: string;
  errorCode?: string;
  details?: unknown;
  statusCode?: number;
  requestId?: string;
  traceId?: string;
}

export interface ApiErrorResponse {
  errorCode: string;
  error: string;
  message: string;
  requestId?: string;
  traceId?: string;
  details?: unknown;
}

/**
 * Auto rewards config shared across Twitch/Kick/Trovo/VKVideo.
 * Stored in DB as Channel.twitchAutoRewardsJson; updated via PATCH /streamer/channel/settings { twitchAutoRewards }.
 */
export type TwitchAutoRewardsV1 = {
  v: 1;
  follow?: { enabled?: boolean; coins?: number; onceEver?: boolean; onlyWhenLive?: boolean };
  subscribe?: { enabled?: boolean; tierCoins?: Record<string, number>; primeCoins?: number; onlyWhenLive?: boolean };
  resubMessage?: {
    enabled?: boolean;
    tierCoins?: Record<string, number>;
    primeCoins?: number;
    bonusCoins?: number;
    onlyWhenLive?: boolean;
  };
  giftSub?: {
    enabled?: boolean;
    giverTierCoins?: Record<string, number>;
    recipientCoins?: number;
    onlyWhenLive?: boolean;
  };
  cheer?: { enabled?: boolean; bitsPerCoin?: number; minBits?: number; onlyWhenLive?: boolean };
  raid?: { enabled?: boolean; baseCoins?: number; coinsPerViewer?: number; minViewers?: number; onlyWhenLive?: boolean };
  channelPoints?: { enabled?: boolean; byRewardId?: Record<string, number>; onlyWhenLive?: boolean };
  chat?: {
    firstMessage?: { enabled?: boolean; coins?: number; onlyWhenLive?: boolean };
    messageThresholds?: {
      enabled?: boolean;
      thresholds?: number[];
      coinsByThreshold?: Record<string, number>;
      onlyWhenLive?: boolean;
    };
    dailyStreak?: { enabled?: boolean; coinsPerDay?: number; coinsByStreak?: Record<string, number> };
  };
};

export type KickAutoRewardsV1 = {
  v: 1;
  follow?: { enabled?: boolean; coins?: number; onceEver?: boolean; onlyWhenLive?: boolean };
  subscribe?: { enabled?: boolean; tierCoins?: Record<string, number>; onlyWhenLive?: boolean };
  giftSub?: { enabled?: boolean; giverCoins?: number; recipientCoins?: number; onlyWhenLive?: boolean };
};

export type TrovoAutoRewardsV1 = {
  v: 1;
  follow?: { enabled?: boolean; coins?: number; onceEver?: boolean; onlyWhenLive?: boolean };
  subscribe?: { enabled?: boolean; tierCoins?: Record<string, number>; onlyWhenLive?: boolean };
  raid?: { enabled?: boolean; baseCoins?: number; coinsPerViewer?: number; minViewers?: number };
};

export type VkVideoAutoRewardsV1 = {
  v: 1;
  follow?: { enabled?: boolean; coins?: number; onceEver?: boolean; onlyWhenLive?: boolean };
  donation?: { enabled?: boolean; coinsPerRuble?: number; minAmount?: number };
};

export type YouTubeAutoRewardsV1 = {
  v: 1;
  subscribe?: { enabled?: boolean; coins?: number; onceEver?: boolean };
  superchat?: { enabled?: boolean; coinsPerCurrency?: Record<string, number>; minAmount?: number };
  membership?: { enabled?: boolean; tierCoins?: Record<string, number> };
  like?: { enabled?: boolean; coins?: number; maxPerStream?: number };
};

