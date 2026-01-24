import { z } from 'zod';
import { normTierKey } from '../../utils/tierKey.js';
import { twitchAutoRewardsSchema } from './rewards.js';

export const updateChannelSettingsSchema = z
  .object({
    rewardIdForCoins: z.string().optional().nullable(),
    coinPerPointRatio: z.number().positive().optional(),
    rewardEnabled: z.boolean().optional(),
    rewardTitle: z.string().optional().nullable(),
    rewardCost: z.number().int().positive().optional().nullable(),
    rewardCoins: z.number().int().positive().optional().nullable(),
    rewardOnlyWhenLive: z.boolean().optional(),
    // Kick rewards -> coins
    kickRewardEnabled: z.boolean().optional(),
    kickRewardIdForCoins: z.string().optional().nullable(),
    kickCoinPerPointRatio: z.number().positive().optional(),
    kickRewardCoins: z.number().int().positive().optional().nullable(),
    kickRewardOnlyWhenLive: z.boolean().optional(),
    // Trovo spells -> coins
    trovoManaCoinsPerUnit: z.number().int().min(0).optional(),
    trovoElixirCoinsPerUnit: z.number().int().min(0).optional(),
    // VKVideo channel points -> coins
    vkvideoRewardEnabled: z.boolean().optional(),
    vkvideoRewardIdForCoins: z.string().optional().nullable(),
    vkvideoCoinPerPointRatio: z.number().positive().optional(),
    vkvideoRewardCoins: z.number().int().positive().optional().nullable(),
    vkvideoRewardOnlyWhenLive: z.boolean().optional(),
    // YouTube "like stream" -> coins
    youtubeLikeRewardEnabled: z.boolean().optional(),
    youtubeLikeRewardCoins: z.number().int().min(0).optional(),
    youtubeLikeRewardOnlyWhenLive: z.boolean().optional(),
    // Twitch auto rewards (frontend-configured JSONB).
    // null clears config.
    twitchAutoRewards: twitchAutoRewardsSchema.optional().nullable(),
    // Legacy single reward field (kept for back-compat).
    submissionRewardCoins: z.number().int().min(0).optional(),
    // New split fields.
    submissionRewardCoinsUpload: z.number().int().min(0).optional(),
    submissionRewardCoinsPool: z.number().int().min(0).optional(),
    // Legacy: ignored for pool-import rewards (we always reward).
    submissionRewardOnlyWhenLive: z.boolean().optional(),
    // Viewer submissions gate (global per-channel).
    submissionsEnabled: z.boolean().optional(),
    // Allow submissions only while stream is online (uses best-effort stream status store).
    submissionsOnlyWhenLive: z.boolean().optional(),
    primaryColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional()
      .nullable(),
    secondaryColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional()
      .nullable(),
    accentColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional()
      .nullable(),
    // OBS overlay settings (server-side defaults, applied to token-based overlay joins)
    overlayMode: z.enum(['queue', 'simultaneous']).optional(),
    overlayShowSender: z.boolean().optional(),
    overlayMaxConcurrent: z.number().int().min(1).max(5).optional(),
    overlayStyleJson: z.string().max(50_000).optional().nullable(),
    // Meme catalog mode (what users can browse/activate on channel page)
    memeCatalogMode: z.enum(['channel', 'pool_all']).optional(),
    // Streamer dashboard layout (card order). Null => reset to default (unset in DB).
    dashboardCardOrder: z.array(z.string()).max(50).optional().nullable(),
    // Boosty integration
    boostyBlogName: z.string().min(1).max(200).optional().nullable(),
    boostyCoinsPerSub: z.number().int().min(0).optional(),
    // Discord guild where Boosty integration issues roles for this channel.
    // null => fall back to DISCORD_DEFAULT_SUBSCRIPTIONS_GUILD_ID (or legacy DISCORD_SUBSCRIPTIONS_GUILD_ID).
    discordSubscriptionsGuildId: z
      .preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1).max(64))
      .optional()
      .nullable(),
    // Boosty via Boosty API (tiers): mapping tierKey -> coins.
    // Stored in DB as JSONB array of objects [{ tierKey, coins }, ...]
    boostyTierCoins: z
      .array(
        z.object({
          tierKey: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1).max(120)),
          coins: z.number().int().min(0).max(1_000_000),
        })
      )
      .max(100)
      .optional()
      .nullable(),
    // Boosty via Discord roles (tiers): mapping tier -> Discord role id.
    // Stored in DB as JSONB array of objects [{ tier, roleId }, ...]
    boostyDiscordTierRoles: z
      .array(
        z.object({
          tier: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.string().min(1).max(80)),
          roleId: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1).max(64)),
        })
      )
      .max(50)
      .optional()
      .nullable(),
  })
  .superRefine((obj, ctx) => {
    // Validate boostyTierCoins uniqueness
    const tierCoins = (obj as Record<string, unknown>)?.boostyTierCoins;
    if (Array.isArray(tierCoins)) {
      const seen = new Set<string>();
      for (let i = 0; i < tierCoins.length; i += 1) {
        const tierKey = normTierKey(tierCoins[i]?.tierKey);
        if (!tierKey) continue;
        if (seen.has(tierKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['boostyTierCoins', i, 'tierKey'],
            message: `Duplicate tierKey (case-insensitive): ${tierKey}`,
          });
        }
        seen.add(tierKey);
      }
    }

    const items = (obj as Record<string, unknown>)?.boostyDiscordTierRoles;
    if (!Array.isArray(items)) return;

    const seenTier = new Set<string>();
    const seenRoleId = new Set<string>();
    for (let i = 0; i < items.length; i += 1) {
      const tier = String(items[i]?.tier ?? '')
        .trim()
        .toLowerCase();
      const roleId = String(items[i]?.roleId ?? '').trim();
      if (!tier || !roleId) continue;

      if (seenTier.has(tier)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['boostyDiscordTierRoles', i, 'tier'],
          message: 'Tier must be unique',
        });
      }
      if (seenRoleId.has(roleId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['boostyDiscordTierRoles', i, 'roleId'],
          message: 'roleId must be unique',
        });
      }
      seenTier.add(tier);
      seenRoleId.add(roleId);
    }
  });

// OBS overlay presets (per-channel)
export const overlayPresetPayloadSchema = z
  .object({
    v: z.number().int().min(1).max(10),
    overlayMode: z.enum(['queue', 'simultaneous']).optional(),
    overlayShowSender: z.boolean().optional(),
    overlayMaxConcurrent: z.number().int().min(1).max(5).optional(),
    style: z.unknown().optional(),
  })
  .passthrough();

export const overlayPresetSchema = z.object({
  id: z.string().min(2).max(80),
  name: z.string().min(1).max(120),
  createdAt: z.number().int().nonnegative(),
  payload: overlayPresetPayloadSchema,
});

export const overlayPresetsBodySchema = z.object({
  presets: z.array(overlayPresetSchema).max(30),
});

export const createPromotionSchema = z.object({
  name: z.string().min(1).max(200),
  discountPercent: z.number().min(0).max(100),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

export const updatePromotionSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  isActive: z.boolean().optional(),
});
