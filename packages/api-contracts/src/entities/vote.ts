import { z } from 'zod';

export const VoteStatusSchema = z.enum(['active', 'ended', 'cancelled']);

export const VoteOptionSchema = z.object({
  index: z.number().int(),
  channelMemeId: z.string(),
  title: z.string(),
  previewUrl: z.string().nullable().optional(),
  memeType: z.string().optional(),
  totalVotes: z.number().int().nonnegative(),
});

export const VoteSessionSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  status: VoteStatusSchema,
  startedAt: z.string(),
  endsAt: z.string().nullable().optional(),
  endedAt: z.string().nullable().optional(),
  options: z.array(VoteOptionSchema),
  totalVotes: z.number().int().nonnegative(),
  winnerIndex: z.number().int().nullable().optional(),
});

export type VoteStatus = z.infer<typeof VoteStatusSchema>;
export type VoteOption = z.infer<typeof VoteOptionSchema>;
export type VoteSession = z.infer<typeof VoteSessionSchema>;
