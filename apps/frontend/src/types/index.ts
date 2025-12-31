export type UserRole = 'viewer' | 'streamer' | 'admin';

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
}

export type ExternalAccountProvider = 'twitch' | string;

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
  fileUrl: string;
  fileHash?: string | null;
  priceCoins: number;
  durationMs: number;
  status?: MemeStatus;
  channelId?: string;
  deletedAt?: string | null;
  tags?: Array<{ tag: Tag }>;
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

export type SubmissionStatus = 'pending' | 'needs_changes' | 'approved' | 'rejected';

export interface Tag {
  id: string;
  name: string;
}

export interface Submission {
  id: string;
  title: string;
  type: MemeType;
  fileUrlTemp: string;
  sourceUrl?: string | null;
  notes: string | null;
  status: SubmissionStatus;
  sourceKind?: 'upload' | 'url' | 'pool';
  memeAssetId?: string | null;
  moderatorNotes?: string | null;
  revision?: number; // number of resubmits after "needs_changes" (0..2)
  tags?: Array<{ tag: Tag }>;
  submitter: {
    id: string;
    displayName: string;
  };
  createdAt: string;
}

export interface ApiError {
  message: string;
  error?: string;
  errorCode?: string;
  details?: unknown;
  statusCode?: number;
}

