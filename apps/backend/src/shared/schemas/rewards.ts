import { z } from 'zod';

const twitchCoinsSchema = z.number().int().min(0).max(1_000_000);
const twitchTierCoinsMapSchema = z.record(z.string().min(1).max(16), twitchCoinsSchema).optional();

// Twitch auto rewards settings (stored in Channel.twitchAutoRewardsJson as JSONB).
// Frontend-owned config: keep schema permissive but bounded.
export const twitchAutoRewardsSchema = z
  .object({
    v: z.number().int().min(1).max(1).default(1),
    follow: z
      .object({
        enabled: z.boolean().optional(),
        coins: twitchCoinsSchema.optional(),
        onceEver: z.boolean().optional().default(true),
        onlyWhenLive: z.boolean().optional(),
      })
      .optional(),
    subscribe: z
      .object({
        enabled: z.boolean().optional(),
        tierCoins: twitchTierCoinsMapSchema,
        primeCoins: twitchCoinsSchema.optional(),
        onlyWhenLive: z.boolean().optional(),
      })
      .optional(),
    resubMessage: z
      .object({
        enabled: z.boolean().optional(),
        tierCoins: twitchTierCoinsMapSchema,
        primeCoins: twitchCoinsSchema.optional(),
        bonusCoins: twitchCoinsSchema.optional(),
        onlyWhenLive: z.boolean().optional(),
      })
      .optional(),
    giftSub: z
      .object({
        enabled: z.boolean().optional(),
        giverTierCoins: twitchTierCoinsMapSchema,
        recipientCoins: twitchCoinsSchema.optional(),
        onlyWhenLive: z.boolean().optional(),
      })
      .optional(),
    cheer: z
      .object({
        enabled: z.boolean().optional(),
        bitsPerCoin: z.number().int().min(1).max(100_000).optional(),
        minBits: z.number().int().min(1).max(1_000_000).optional(),
        onlyWhenLive: z.boolean().optional(),
      })
      .optional(),
    raid: z
      .object({
        enabled: z.boolean().optional(),
        baseCoins: twitchCoinsSchema.optional(),
        coinsPerViewer: z.number().int().min(0).max(100_000).optional(),
        minViewers: z.number().int().min(0).max(1_000_000).optional(),
        onlyWhenLive: z.boolean().optional(),
      })
      .optional(),
    channelPoints: z
      .object({
        enabled: z.boolean().optional(),
        byRewardId: z.record(z.string().min(1).max(128), twitchCoinsSchema).optional(),
        onlyWhenLive: z.boolean().optional(),
      })
      .optional(),
    chat: z
      .object({
        firstMessage: z
          .object({
            enabled: z.boolean().optional(),
            coins: twitchCoinsSchema.optional(),
            onlyWhenLive: z.boolean().optional(),
          })
          .optional(),
        messageThresholds: z
          .object({
            enabled: z.boolean().optional(),
            thresholds: z.array(z.number().int().min(1).max(100_000)).max(20).optional(),
            coinsByThreshold: z.record(z.string().min(1).max(16), twitchCoinsSchema).optional(),
            onlyWhenLive: z.boolean().optional(),
          })
          .optional(),
        dailyStreak: z
          .object({
            enabled: z.boolean().optional(),
            coinsPerDay: twitchCoinsSchema.optional(),
            coinsByStreak: z.record(z.string().min(1).max(16), twitchCoinsSchema).optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough();

export type TwitchAutoRewardsConfig = z.infer<typeof twitchAutoRewardsSchema>;
