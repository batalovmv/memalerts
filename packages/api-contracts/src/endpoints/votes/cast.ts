import { z } from 'zod';

import { VoteSessionSchema } from '../../entities/vote';

export const CastVoteParamsSchema = z.object({
  slug: z.string(),
  sessionId: z.string(),
});

export const CastVoteBodySchema = z.object({
  optionIndex: z.number().int().min(1).max(3),
});

export const CastVoteResponseSchema = z.object({
  session: VoteSessionSchema,
  myVoteIndex: z.number().int().min(1).max(3).optional(),
});

export type CastVoteParams = z.infer<typeof CastVoteParamsSchema>;
export type CastVoteBody = z.infer<typeof CastVoteBodySchema>;
export type CastVoteResponse = z.infer<typeof CastVoteResponseSchema>;
