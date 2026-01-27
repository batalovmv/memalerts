import { z } from 'zod';

export const updateChannelSettingsSchema = z.object({
    rewardIdForCoins: z.string().optional().nullable(),
    coinPerPointRatio: z.number().positive().optional(),
    rewardEnabled: z.boolean().optional(),
    rewardTitle: z.string().optional().nullable(),
    rewardCost: z.number().int().positive().optional().nullable(),
    rewardCoins: z.number().int().positive().optional().nullable(),
    rewardOnlyWhenLive: z.boolean().optional(),
    // VKVideo channel points -> coins
    vkvideoRewardEnabled: z.boolean().optional(),
    vkvideoRewardIdForCoins: z.string().optional().nullable(),
    vkvideoCoinPerPointRatio: z.number().positive().optional(),
    vkvideoRewardCoins: z.number().int().positive().optional().nullable(),
    vkvideoRewardOnlyWhenLive: z.boolean().optional(),
    // Legacy single reward field (kept for back-compat).
    submissionRewardCoins: z.number().int().min(0).optional(),
    // New split fields.
    submissionRewardCoinsUpload: z.number().int().min(0).max(100).optional(),
    submissionRewardCoinsPool: z.number().int().min(0).max(100).optional(),
    // Legacy: ignored for pool-import rewards (we always reward).
    submissionRewardOnlyWhenLive: z.boolean().optional(),
    // Viewer submissions gate (global per-channel).
    submissionsEnabled: z.boolean().optional(),
    // Allow submissions only while stream is online (uses best-effort stream status store).
    submissionsOnlyWhenLive: z.boolean().optional(),
    autoApproveEnabled: z.boolean().optional(),
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
    // Economy settings
    economyMemesPerHour: z.number().int().min(1).max(10).optional(),
    economyRewardMultiplier: z.number().min(0.5).max(2.0).optional(),
    economyApprovalBonusCoins: z.number().int().min(0).max(100).optional(),
    defaultPriceCoins: z.number().int().min(1).max(10_000).optional(),
    // Meme catalog mode (what users can browse/activate on channel page)
    memeCatalogMode: z.enum(['channel', 'pool_all']).optional(),
    // Streamer dashboard layout (card order). Null => reset to default (unset in DB).
    dashboardCardOrder: z.array(z.string()).max(50).optional().nullable(),
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
