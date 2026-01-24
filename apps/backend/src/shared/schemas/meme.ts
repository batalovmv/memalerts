import { z } from 'zod';

export const memeTypeSchema = z.enum(['image', 'gif', 'video', 'audio']);
export const memeStatusSchema = z.enum(['pending', 'approved', 'rejected']);

export const updateMemeSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  priceCoins: z.number().int().positive().optional(),
  durationMs: z.number().int().positive().optional(),
});

export const activateMemeSchema = z.object({
  memeId: z.string().uuid(),
});
