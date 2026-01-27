import { z } from 'zod';

import { VoteSessionSchema } from '../../entities/vote';

export const CreateVoteBodySchema = z.object({
  channelMemeIds: z.array(z.string()).length(3).optional(),
  durationSeconds: z.number().int().min(15).max(600).optional(),
});

export const CreateVoteResponseSchema = z.object({
  session: VoteSessionSchema,
});

export type CreateVoteBody = z.infer<typeof CreateVoteBodySchema>;
export type CreateVoteResponse = z.infer<typeof CreateVoteResponseSchema>;
