import { z } from 'zod';
import { createSuccessSchema } from '../../common/responses';

export const ActivateMemeParamsSchema = z.object({
  memeId: z.string().uuid(),
});

export const ActivateMemeBodySchema = z.object({
  channelId: z.string().uuid(),
  volume: z.number().min(0).max(1).default(1),
});

export const ActivateMemeResponseDataSchema = z.object({
  activationId: z.string().uuid(),
  balanceAfter: z.number().int(),
  cooldownUntil: z.string().datetime().nullable(),
});

export const ActivateMemeResponseSchema = createSuccessSchema(ActivateMemeResponseDataSchema);

export type ActivateMemeParams = z.infer<typeof ActivateMemeParamsSchema>;
export type ActivateMemeBody = z.infer<typeof ActivateMemeBodySchema>;
export type ActivateMemeResponse = z.infer<typeof ActivateMemeResponseSchema>;
