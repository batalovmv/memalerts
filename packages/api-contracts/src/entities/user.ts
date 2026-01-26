import { z } from 'zod';

import { UserRoleSchema } from '../common/enums';
import { ChannelSchema } from './channel';

export const ExternalAccountProviderSchema = z.string();

export const ExternalAccountSchema = z.object({
  id: z.string(),
  provider: ExternalAccountProviderSchema,
  providerAccountId: z.string().nullable().optional(),
  providerUserId: z.string().nullable().optional(),
  login: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
  profileImageUrl: z.string().nullable().optional(),
  profileUrl: z.string().nullable().optional(),
  linkedAt: z.string().optional(),
  lastUsedAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const PendingCoinGrantSchema = z.object({
  id: z.string(),
  provider: z.string(),
  externalAccountId: z.string(),
  coins: z.number(),
  reason: z.string(),
  createdAt: z.string(),
});

export const WalletSchema = z.object({
  id: z.string(),
  userId: z.string(),
  channelId: z.string(),
  balance: z.number(),
  updatedAt: z.string().optional(),
});

export const UserSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  profileImageUrl: z.string().nullable().optional(),
  role: UserRoleSchema,
  isGlobalModerator: z.boolean().optional(),
  channelId: z.string().nullable(),
  channel: ChannelSchema.optional(),
  wallets: z.array(WalletSchema).optional(),
  externalAccounts: z.array(ExternalAccountSchema).optional(),
  pendingCoinGrants: z.array(PendingCoinGrantSchema).optional(),
});

export type ExternalAccountProvider = z.infer<typeof ExternalAccountProviderSchema>;
export type ExternalAccount = z.infer<typeof ExternalAccountSchema>;
export type PendingCoinGrant = z.infer<typeof PendingCoinGrantSchema>;
export type Wallet = z.infer<typeof WalletSchema>;
export type User = z.infer<typeof UserSchema>;
