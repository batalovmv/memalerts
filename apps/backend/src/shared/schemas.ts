import { z } from 'zod';

export const memeTypeSchema = z.enum(['image', 'gif', 'video', 'audio']);
export const memeStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export const submissionStatusSchema = z.enum(['pending', 'needs_changes', 'approved', 'rejected']);
export const activationStatusSchema = z.enum(['queued', 'playing', 'done', 'failed']);
export const userRoleSchema = z.enum(['viewer', 'streamer', 'admin']);

export const createSubmissionSchema = z.object({
  title: z.string().min(1).max(200),
  type: z.literal('video'), // Only video allowed
  notes: z.string().max(500).optional().nullable(),
  tags: z.array(z.string().min(1).max(50)).optional().default([]), // Array of tag names
});

export const importMemeSchema = z.object({
  title: z.string().min(1).max(200),
  sourceUrl: z.string().url(), // URL from memalerts.com
  notes: z.string().max(500).optional().nullable(),
  tags: z.array(z.string().min(1).max(50)).optional().default([]), // Array of tag names
});

export const approveSubmissionSchema = z.object({
  priceCoins: z.number().int().positive().optional().default(100), // Standard price: 100 coins
  durationMs: z.number().int().positive().optional().default(15000), // Standard duration: 15 seconds (15000ms)
  tags: z.array(z.string().min(1).max(50)).optional().default([]), // Tags to apply to approved meme
});

export const rejectSubmissionSchema = z.object({
  moderatorNotes: z.string().max(1000).optional().nullable(),
});

export const needsChangesSubmissionSchema = z.object({
  moderatorNotes: z.string().min(1).max(1000),
});

export const resubmitSubmissionSchema = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(500).optional().nullable(),
  tags: z.array(z.string().min(1).max(50)).optional().default([]),
});

export const updateMemeSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  priceCoins: z.number().int().positive().optional(),
  durationMs: z.number().int().positive().optional(),
});

export const updateChannelSettingsSchema = z.object({
  rewardIdForCoins: z.string().optional().nullable(),
  coinPerPointRatio: z.number().positive().optional(),
  rewardEnabled: z.boolean().optional(),
  rewardTitle: z.string().optional().nullable(),
  rewardCost: z.number().int().positive().optional().nullable(),
  rewardCoins: z.number().int().positive().optional().nullable(),
  submissionRewardCoins: z.number().int().min(0).optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  // OBS overlay settings (server-side defaults, applied to token-based overlay joins)
  overlayMode: z.enum(['queue', 'simultaneous']).optional(),
  overlayShowSender: z.boolean().optional(),
  overlayMaxConcurrent: z.number().int().min(1).max(5).optional(),
  overlayStyleJson: z.string().max(50_000).optional().nullable(),
});

export const createPromotionSchema = z.object({
  name: z.string().min(1).max(200),
  discountPercent: z.number().min(0).max(100),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

export const updatePromotionSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  isActive: z.boolean().optional(),
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


