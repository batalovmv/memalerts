import type { UserRole } from './common';
import type { Channel } from './channel';

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

export interface WalletTransaction {
  id: string;
  userId: string;
  channelId: string;
  delta: number;
  reason?: string | null;
  createdAt?: string;
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
