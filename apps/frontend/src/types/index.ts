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
  createdAt?: string;
  updatedAt?: string;
}

export interface User {
  id: string;
  displayName: string;
  profileImageUrl?: string | null;
  role: UserRole;
  channelId: string | null;
  channel?: Channel;
  wallets?: Wallet[];
  externalAccounts?: ExternalAccount[];
}

export type MemeType = 'image' | 'gif' | 'video' | 'audio';

export type MemeStatus = 'active' | 'inactive' | 'pending';

export interface Meme {
  id: string;
  title: string;
  type: MemeType;
  fileUrl: string;
  priceCoins: number;
  durationMs: number;
  status?: MemeStatus;
  channelId?: string;
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
  notes: string | null;
  status: SubmissionStatus;
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
  statusCode?: number;
}

