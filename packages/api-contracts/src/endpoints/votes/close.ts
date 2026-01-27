import { z } from 'zod';

import { VoteSessionSchema } from '../../entities/vote';

export const CloseVoteParamsSchema = z.object({
  sessionId: z.string(),
});

export const CloseVoteResponseSchema = z.object({
  session: VoteSessionSchema,
});

export type CloseVoteParams = z.infer<typeof CloseVoteParamsSchema>;
export type CloseVoteResponse = z.infer<typeof CloseVoteResponseSchema>;
