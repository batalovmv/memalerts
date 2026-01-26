import { z } from 'zod';

import { BotProviderSchema, MemeCatalogModeSchema } from '../common/enums';
import {
  KickAutoRewardsV1Schema,
  TrovoAutoRewardsV1Schema,
  TwitchAutoRewardsV1Schema,
  VkVideoAutoRewardsV1Schema,
  YouTubeAutoRewardsV1Schema,
} from './autoRewards';

export const CreditsEntrySchema = z.object({
  displayName: z.string(),
  amount: z.number().optional(),
  message: z.string().optional(),
});

export const BotIntegrationSettingsSchema = z.object({
  provider: BotProviderSchema,
  enabled: z.boolean(),
  useDefaultBot: z.boolean(),
  channelUrl: z.string().nullable().optional(),
});

export const EntitlementTypeSchema = z.enum(['custom_bot', 'extended_overlay', 'priority_ai']);

export const ChannelEntitlementSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  type: EntitlementTypeSchema,
  grantedBy: z.string(),
  grantedAt: z.string(),
  expiresAt: z.string().nullable().optional(),
});

export const ChannelSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  memeCatalogMode: MemeCatalogModeSchema.optional(),
  twitchChannelId: z.string().nullable().optional(),
  submissionRewardCoinsUpload: z.number().optional(),
  submissionRewardCoinsPool: z.number().optional(),
  submissionRewardCoins: z.number().optional(),
  autoApproveEnabled: z.boolean().optional(),
  overlayStyleJson: z.string().nullable().optional(),
  creditsStyleJson: z.string().nullable().optional(),
  botIntegrations: z.array(BotIntegrationSettingsSchema).optional(),
  twitchAutoRewardsJson: TwitchAutoRewardsV1Schema.nullable().optional(),
  kickAutoRewardsJson: KickAutoRewardsV1Schema.nullable().optional(),
  trovoAutoRewardsJson: TrovoAutoRewardsV1Schema.nullable().optional(),
  vkvideoAutoRewardsJson: VkVideoAutoRewardsV1Schema.nullable().optional(),
  youtubeAutoRewardsJson: YouTubeAutoRewardsV1Schema.nullable().optional(),
});

export type CreditsEntry = z.infer<typeof CreditsEntrySchema>;
export type BotIntegrationSettings = z.infer<typeof BotIntegrationSettingsSchema>;
export type EntitlementType = z.infer<typeof EntitlementTypeSchema>;
export type ChannelEntitlement = z.infer<typeof ChannelEntitlementSchema>;
export type Channel = z.infer<typeof ChannelSchema>;
