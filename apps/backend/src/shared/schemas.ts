import { z } from 'zod';

export const memeTypeSchema = z.enum(['image', 'gif', 'video', 'audio']);
export const memeStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export const submissionStatusSchema = z.enum(['pending', 'needs_changes', 'approved', 'rejected']);
export const activationStatusSchema = z.enum(['queued', 'playing', 'done', 'failed']);
export const userRoleSchema = z.enum(['viewer', 'streamer', 'admin']);

export const createSubmissionSchema = z.object({
  title: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().min(1).max(200)
  ),
  type: z.literal('video'), // Only video allowed
  notes: z.string().max(500).optional().nullable(),
  tags: z.array(z.string().min(1).max(50)).optional().default([]), // Array of tag names
});

export const importMemeSchema = z.object({
  title: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().min(1).max(200)
  ),
  sourceUrl: z.string().url(), // URL from memalerts.com
  notes: z.string().max(500).optional().nullable(),
  tags: z.array(z.string().min(1).max(50)).optional().default([]), // Array of tag names
});

export const createPoolSubmissionSchema = z.object({
  channelId: z.string().uuid(),
  memeAssetId: z.string().uuid(),
  // Back-compat: older frontend sent only memeAssetId + channelId.
  // We still require a non-empty title in DB, so provide a safe default.
  title: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().min(1).max(200).optional().default('Untitled')
  ),
  notes: z.string().max(500).optional().nullable(),
  tags: z.array(z.string().min(1).max(50)).optional().default([]),
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
  rewardOnlyWhenLive: z.boolean().optional(),
  // Legacy single reward field (kept for back-compat).
  submissionRewardCoins: z.number().int().min(0).optional(),
  // New split fields.
  submissionRewardCoinsUpload: z.number().int().min(0).optional(),
  submissionRewardCoinsPool: z.number().int().min(0).optional(),
  // Legacy: ignored for pool-import rewards (we always reward).
  submissionRewardOnlyWhenLive: z.boolean().optional(),
  // Viewer submissions gate (global per-channel).
  submissionsEnabled: z.boolean().optional(),
  // Allow submissions only while stream is online (uses best-effort stream status store).
  submissionsOnlyWhenLive: z.boolean().optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  // OBS overlay settings (server-side defaults, applied to token-based overlay joins)
  overlayMode: z.enum(['queue', 'simultaneous']).optional(),
  overlayShowSender: z.boolean().optional(),
  overlayMaxConcurrent: z.number().int().min(1).max(5).optional(),
  overlayStyleJson: z.string().max(50_000).optional().nullable(),
  // Streamer dashboard layout (card order). Null => reset to default (unset in DB).
  dashboardCardOrder: z.array(z.string()).max(50).optional().nullable(),
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

// EventSub: channel.follow (v2)
export const twitchFollowEventSchema = z.object({
  user_id: z.string(),
  user_login: z.string(),
  user_name: z.string(),
  broadcaster_user_id: z.string(),
  broadcaster_user_login: z.string(),
  broadcaster_user_name: z.string(),
  followed_at: z.string(),
});

// Viewer UI preferences (cross-device, per-user)
export const userPreferencesSchema = z.object({
  theme: z.enum(['light', 'dark']).default('light'),
  autoplayMemesEnabled: z.boolean().default(true),
  memeModalMuted: z.boolean().default(false),
  coinsInfoSeen: z.boolean().default(false),
});

// PATCH body: any subset of fields
export const patchUserPreferencesSchema = userPreferencesSchema.partial().refine((obj) => Object.keys(obj).length > 0, {
  message: 'At least one preference field must be provided',
});

// OBS overlay presets (per-channel)
export const overlayPresetPayloadSchema = z
  .object({
    v: z.number().int().min(1).max(10),
    overlayMode: z.enum(['queue', 'simultaneous']).optional(),
    overlayShowSender: z.boolean().optional(),
    overlayMaxConcurrent: z.number().int().min(1).max(5).optional(),
    style: z.any().optional(),
  })
  .passthrough();

export const overlayPresetSchema = z.object({
  id: z.string().min(2).max(80),
  name: z.string().min(1).max(120),
  createdAt: z.number().int().nonnegative(),
  payload: overlayPresetPayloadSchema,
});

export const overlayPresetsBodySchema = z.object({
  presets: z.array(overlayPresetSchema).max(30),
});


