import { z } from 'zod';

import { WheelSpinSchema, WheelStateSchema } from '../../entities/wheel';
import { WalletSchema } from '../../entities/user';

export const SpinWheelParamsSchema = z.object({
  slug: z.string(),
});

export const SpinWheelBodySchema = z.object({
  mode: z.enum(['free', 'paid']).optional(),
});

export const SpinWheelResponseSchema = z.object({
  spin: WheelSpinSchema,
  wallet: WalletSchema,
  state: WheelStateSchema.optional(),
});

export type SpinWheelParams = z.infer<typeof SpinWheelParamsSchema>;
export type SpinWheelBody = z.infer<typeof SpinWheelBodySchema>;
export type SpinWheelResponse = z.infer<typeof SpinWheelResponseSchema>;
