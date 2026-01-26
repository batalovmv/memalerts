import { z } from 'zod';
import { MemeDetailSchema } from '../../entities/meme';
import { createSuccessSchema } from '../../common/responses';

export const GetMemeParamsSchema = z.object({
  memeId: z.string().uuid(),
});

export const GetMemeResponseSchema = createSuccessSchema(MemeDetailSchema);

export type GetMemeParams = z.infer<typeof GetMemeParamsSchema>;
export type GetMemeResponse = z.infer<typeof GetMemeResponseSchema>;
