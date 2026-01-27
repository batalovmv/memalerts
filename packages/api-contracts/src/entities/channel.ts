import { z } from 'zod';

import { BotProviderSchema, MemeCatalogModeSchema } from '../common/enums';
import { EconomySchema } from './economy';
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
  wheelEnabled: z.boolean().optional(),
  wheelPaidSpinCostCoins: z.number().nullable().optional(),
  wheelPrizeMultiplier: z.number().optional(),
  botIntegrations: z.array(BotIntegrationSettingsSchema).optional(),
  economy: EconomySchema.optional(),
});

export type BotIntegrationSettings = z.infer<typeof BotIntegrationSettingsSchema>;
export type EntitlementType = z.infer<typeof EntitlementTypeSchema>;
export type ChannelEntitlement = z.infer<typeof ChannelEntitlementSchema>;
export type Channel = z.infer<typeof ChannelSchema>;
