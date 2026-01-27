import { z } from 'zod';

export const WheelPrizeTierSchema = z.enum(['small', 'medium', 'good', 'big', 'jackpot', 'super']);

export const WheelPrizeSchema = z.object({
  tier: WheelPrizeTierSchema,
  coins: z.number().int().nonnegative(),
  label: z.string(),
  multiplier: z.number().optional(),
});

export const WheelSpinSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  userId: z.string(),
  isFree: z.boolean(),
  costCoins: z.number().int().nonnegative(),
  prize: WheelPrizeSchema,
  createdAt: z.string(),
});

export const WheelStateSchema = z.object({
  enabled: z.boolean(),
  paidSpinCostCoins: z.number().int().nonnegative(),
  freeSpinAvailable: z.boolean(),
  freeSpinCooldownSeconds: z.number().int().nonnegative(),
  nextFreeSpinAt: z.string().nullable().optional(),
  prizeMultiplier: z.number(),
});

export const WheelSettingsSchema = z.object({
  enabled: z.boolean(),
  paidSpinCostCoins: z.number().int().nonnegative().nullable().optional(),
  prizeMultiplier: z.number(),
});

export type WheelPrizeTier = z.infer<typeof WheelPrizeTierSchema>;
export type WheelPrize = z.infer<typeof WheelPrizeSchema>;
export type WheelSpin = z.infer<typeof WheelSpinSchema>;
export type WheelState = z.infer<typeof WheelStateSchema>;
export type WheelSettings = z.infer<typeof WheelSettingsSchema>;
