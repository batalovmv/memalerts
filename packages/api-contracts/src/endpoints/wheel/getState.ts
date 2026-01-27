import { z } from 'zod';

import { WheelStateSchema } from '../../entities/wheel';

export const GetWheelStateParamsSchema = z.object({
  slug: z.string(),
});

export const GetWheelStateResponseSchema = WheelStateSchema;

export type GetWheelStateParams = z.infer<typeof GetWheelStateParamsSchema>;
export type GetWheelStateResponse = z.infer<typeof GetWheelStateResponseSchema>;
