import { z } from 'zod';

const coinsByKeySchema = z.record(z.number());

const baseRewardSchema = z.object({
  enabled: z.boolean().optional(),
  coins: z.number().optional(),
  onceEver: z.boolean().optional(),
  onlyWhenLive: z.boolean().optional(),
});

const tierCoinsSchema = z.object({
  tierCoins: coinsByKeySchema.optional(),
});

export const BaseAutoRewardsConfigSchema = z.object({
  v: z.literal(1),
});

export const TwitchAutoRewardsV1Schema = BaseAutoRewardsConfigSchema.extend({
  follow: baseRewardSchema.optional(),
  subscribe: baseRewardSchema.extend({
    ...tierCoinsSchema.shape,
    primeCoins: z.number().optional(),
  }).optional(),
  resubMessage: baseRewardSchema.extend({
    ...tierCoinsSchema.shape,
    primeCoins: z.number().optional(),
    bonusCoins: z.number().optional(),
  }).optional(),
  giftSub: baseRewardSchema.extend({
    giverTierCoins: coinsByKeySchema.optional(),
    recipientCoins: z.number().optional(),
  }).optional(),
  cheer: z.object({
    enabled: z.boolean().optional(),
    bitsPerCoin: z.number().optional(),
    minBits: z.number().optional(),
    onlyWhenLive: z.boolean().optional(),
  }).optional(),
  raid: z.object({
    enabled: z.boolean().optional(),
    baseCoins: z.number().optional(),
    coinsPerViewer: z.number().optional(),
    minViewers: z.number().optional(),
    onlyWhenLive: z.boolean().optional(),
  }).optional(),
  channelPoints: z.object({
    enabled: z.boolean().optional(),
    byRewardId: coinsByKeySchema.optional(),
    onlyWhenLive: z.boolean().optional(),
  }).optional(),
  chat: z.object({
    firstMessage: baseRewardSchema.optional(),
    messageThresholds: z.object({
      enabled: z.boolean().optional(),
      thresholds: z.array(z.number()).optional(),
      coinsByThreshold: coinsByKeySchema.optional(),
      onlyWhenLive: z.boolean().optional(),
    }).optional(),
    dailyStreak: z.object({
      enabled: z.boolean().optional(),
      coinsPerDay: z.number().optional(),
      coinsByStreak: coinsByKeySchema.optional(),
    }).optional(),
  }).optional(),
});

export const KickAutoRewardsV1Schema = BaseAutoRewardsConfigSchema.extend({
  follow: baseRewardSchema.optional(),
  subscribe: baseRewardSchema.extend({
    ...tierCoinsSchema.shape,
  }).optional(),
  giftSub: baseRewardSchema.extend({
    giverCoins: z.number().optional(),
    recipientCoins: z.number().optional(),
  }).optional(),
});

export const TrovoAutoRewardsV1Schema = BaseAutoRewardsConfigSchema.extend({
  follow: baseRewardSchema.optional(),
  subscribe: baseRewardSchema.extend({
    ...tierCoinsSchema.shape,
  }).optional(),
  raid: z.object({
    enabled: z.boolean().optional(),
    baseCoins: z.number().optional(),
    coinsPerViewer: z.number().optional(),
    minViewers: z.number().optional(),
  }).optional(),
});

export const VkVideoAutoRewardsV1Schema = BaseAutoRewardsConfigSchema.extend({
  follow: baseRewardSchema.optional(),
  donation: z.object({
    enabled: z.boolean().optional(),
    coinsPerRuble: z.number().optional(),
    minAmount: z.number().optional(),
  }).optional(),
});

export const YouTubeAutoRewardsV1Schema = BaseAutoRewardsConfigSchema.extend({
  subscribe: baseRewardSchema.optional(),
  superchat: z.object({
    enabled: z.boolean().optional(),
    coinsPerCurrency: coinsByKeySchema.optional(),
    minAmount: z.number().optional(),
  }).optional(),
  membership: z.object({
    enabled: z.boolean().optional(),
    tierCoins: coinsByKeySchema.optional(),
  }).optional(),
  like: z.object({
    enabled: z.boolean().optional(),
    coins: z.number().optional(),
    maxPerStream: z.number().optional(),
  }).optional(),
});

export type BaseAutoRewardsConfig = z.infer<typeof BaseAutoRewardsConfigSchema>;
export type TwitchAutoRewardsV1 = z.infer<typeof TwitchAutoRewardsV1Schema>;
export type KickAutoRewardsV1 = z.infer<typeof KickAutoRewardsV1Schema>;
export type TrovoAutoRewardsV1 = z.infer<typeof TrovoAutoRewardsV1Schema>;
export type VkVideoAutoRewardsV1 = z.infer<typeof VkVideoAutoRewardsV1Schema>;
export type YouTubeAutoRewardsV1 = z.infer<typeof YouTubeAutoRewardsV1Schema>;
