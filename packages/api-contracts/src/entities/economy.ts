import { z } from 'zod';

export const EconomySettingsSchema = z.object({
  memesPerHour: z.number(),
  avgMemePriceCoins: z.number(),
  rewardMultiplier: z.number(),
  approvalBonusCoins: z.number(),
});

export const EconomyComputedSchema = z.object({
  streamHoursLastWeek: z.number(),
  dailyBonusCoins: z.number(),
  watchBonusCoins: z.number(),
});

export const EconomyStreamSchema = z.object({
  status: z.enum(['online', 'offline']),
});

export const EconomyViewerDailySchema = z.object({
  lastClaimAt: z.string().nullable().optional(),
  nextClaimAt: z.string().nullable().optional(),
  canClaim: z.boolean(),
  cooldownSecondsRemaining: z.number().int().nonnegative(),
  streakCount: z.number().int().optional(),
  streakMultiplier: z.number().optional(),
});

export const EconomyViewerWatchSchema = z.object({
  lastClaimAt: z.string().nullable().optional(),
  nextClaimAt: z.string().nullable().optional(),
  canClaim: z.boolean(),
  cooldownSecondsRemaining: z.number().int().nonnegative(),
  claimsThisStream: z.number().int(),
  maxClaimsPerStream: z.number().int(),
});

export const EconomyViewerSchema = z.object({
  daily: EconomyViewerDailySchema,
  watch: EconomyViewerWatchSchema,
});

export const EconomySchema = z.object({
  settings: EconomySettingsSchema,
  computed: EconomyComputedSchema,
  stream: EconomyStreamSchema,
  serverNow: z.string(),
  viewer: EconomyViewerSchema.optional(),
});

export type EconomySettings = z.infer<typeof EconomySettingsSchema>;
export type EconomyComputed = z.infer<typeof EconomyComputedSchema>;
export type EconomyViewerDaily = z.infer<typeof EconomyViewerDailySchema>;
export type EconomyViewerWatch = z.infer<typeof EconomyViewerWatchSchema>;
export type EconomyViewer = z.infer<typeof EconomyViewerSchema>;
export type ChannelEconomy = z.infer<typeof EconomySchema>;
