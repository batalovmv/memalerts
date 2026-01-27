import { z } from 'zod';

import { WheelSettingsSchema } from '../../entities/wheel';

export const GetWheelSettingsResponseSchema = WheelSettingsSchema;

export const UpdateWheelSettingsBodySchema = WheelSettingsSchema.partial();

export type GetWheelSettingsResponse = z.infer<typeof GetWheelSettingsResponseSchema>;
export type UpdateWheelSettingsBody = z.infer<typeof UpdateWheelSettingsBodySchema>;
