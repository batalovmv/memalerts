import { z } from 'zod';

import { StreamRecapSchema } from '../../entities/streamRecap';

export const GetLatestStreamRecapResponseSchema = z.object({
  recap: StreamRecapSchema.nullable(),
});

export type GetLatestStreamRecapResponse = z.infer<typeof GetLatestStreamRecapResponseSchema>;
