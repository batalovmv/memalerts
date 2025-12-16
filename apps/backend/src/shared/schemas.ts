import { z } from 'zod';

export const memeTypeSchema = z.enum(['image', 'gif', 'video', 'audio']);
export const memeStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export const submissionStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export const activationStatusSchema = z.enum(['queued', 'playing', 'done', 'failed']);
export const userRoleSchema = z.enum(['viewer', 'streamer', 'admin']);

export const createSubmissionSchema = z.object({
  title: z.string().min(1).max(200),
  type: z.literal('video'), // Only video allowed
  notes: z.string().max(500).optional().nullable(),
});

export const importMemeSchema = z.object({
  title: z.string().min(1).max(200),
  sourceUrl: z.string().url(), // URL from memalerts.com
  notes: z.string().max(500).optional().nullable(),
});

export const approveSubmissionSchema = z.object({
  priceCoins: z.number().int().positive(),
  durationMs: z.number().int().positive(),
});

export const rejectSubmissionSchema = z.object({
  moderatorNotes: z.string().max(1000),
});

export const updateMemeSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  priceCoins: z.number().int().positive().optional(),
  durationMs: z.number().int().positive().optional(),
});

export const updateChannelSettingsSchema = z.object({
  rewardIdForCoins: z.string().optional().nullable(),
  coinPerPointRatio: z.number().positive().optional(),
});

export const activateMemeSchema = z.object({
  memeId: z.string().uuid(),
});

export const twitchEventSubMessageSchema = z.object({
  subscription: z.object({
    id: z.string(),
    type: z.string(),
    version: z.string(),
    status: z.string(),
    condition: z.record(z.any()),
    transport: z.object({
      method: z.string(),
      callback: z.string().optional(),
    }),
    created_at: z.string(),
  }),
  event: z.record(z.any()),
});

export const twitchRedemptionEventSchema = z.object({
  id: z.string(),
  broadcaster_user_id: z.string(),
  broadcaster_user_login: z.string(),
  broadcaster_user_name: z.string(),
  user_id: z.string(),
  user_login: z.string(),
  user_name: z.string(),
  user_input: z.string(),
  status: z.string(),
  reward: z.object({
    id: z.string(),
    title: z.string(),
    prompt: z.string(),
    cost: z.number(),
  }),
  redeemed_at: z.string(),
});


