import { z } from 'zod';

import { VoteSessionSchema } from '../../entities/vote';

export const GetActiveVoteParamsSchema = z.object({
  slug: z.string(),
});

export const GetActiveVoteResponseSchema = z.object({
  session: VoteSessionSchema.nullable(),
});

export type GetActiveVoteParams = z.infer<typeof GetActiveVoteParamsSchema>;
export type GetActiveVoteResponse = z.infer<typeof GetActiveVoteResponseSchema>;
