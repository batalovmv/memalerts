import { z } from 'zod';
import { normTierKey } from '../utils/tierKey.js';

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

const twitchCoinsSchema = z.number().int().min(0).max(1_000_000);
const twitchTierCoinsMapSchema = z.record(z.string().min(1).max(16), twitchCoinsSchema).optional();

// Twitch auto rewards settings (stored in Channel.twitchAutoRewardsJson as JSONB).
// Frontend-owned config: keep schema permissive but bounded.
export const twitchAutoRewardsSchema = z
  .object({
    v: z.number().int().min(1).max(1).default(1),
    follow: z
      .object({
        enabled: z.boolean().optional(),
        coins: twitchCoinsSchema.optional(),
        onceEver: z.boolean().optional().default(true),
        onlyWhenLive: z.boolean().optional(),
      })
      .optional(),
    subscribe: z
      .object({
        enabled: z.boolean().optional(),
        tierCoins: twitchTierCoinsMapSchema,
        primeCoins: twitchCoinsSchema.optional(),
        onlyWhenLive: z.boolean().optional(),
      })
      .optional(),
    resubMessage: z
      .object({
        enabled: z.boolean().optional(),
        tierCoins: twitchTierCoinsMapSchema,
        primeCoins: twitchCoinsSchema.optional(),
        bonusCoins: twitchCoinsSchema.optional(),
        onlyWhenLive: z.boolean().optional(),
      })
      .optional(),
    giftSub: z
      .object({
        enabled: z.boolean().optional(),
        giverTierCoins: twitchTierCoinsMapSchema,
        recipientCoins: twitchCoinsSchema.optional(),
        onlyWhenLive: z.boolean().optional(),
      })
      .optional(),
    cheer: z
      .object({
        enabled: z.boolean().optional(),
        bitsPerCoin: z.number().int().min(1).max(100_000).optional(),
        minBits: z.number().int().min(1).max(1_000_000).optional(),
        onlyWhenLive: z.boolean().optional(),
      })
      .optional(),
    raid: z
      .object({
        enabled: z.boolean().optional(),
        baseCoins: twitchCoinsSchema.optional(),
        coinsPerViewer: z.number().int().min(0).max(100_000).optional(),
        minViewers: z.number().int().min(0).max(1_000_000).optional(),
        onlyWhenLive: z.boolean().optional(),
      })
      .optional(),
    channelPoints: z
      .object({
        enabled: z.boolean().optional(),
        byRewardId: z.record(z.string().min(1).max(128), twitchCoinsSchema).optional(),
        onlyWhenLive: z.boolean().optional(),
      })
      .optional(),
    chat: z
      .object({
        firstMessage: z
          .object({
            enabled: z.boolean().optional(),
            coins: twitchCoinsSchema.optional(),
            onlyWhenLive: z.boolean().optional(),
          })
          .optional(),
        messageThresholds: z
          .object({
            enabled: z.boolean().optional(),
            thresholds: z.array(z.number().int().min(1).max(100_000)).max(20).optional(),
            coinsByThreshold: z.record(z.string().min(1).max(16), twitchCoinsSchema).optional(),
            onlyWhenLive: z.boolean().optional(),
          })
          .optional(),
        dailyStreak: z
          .object({
            enabled: z.boolean().optional(),
            coinsPerDay: twitchCoinsSchema.optional(),
            coinsByStreak: z.record(z.string().min(1).max(16), twitchCoinsSchema).optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough();

export const updateChannelSettingsSchema = z.object({
  rewardIdForCoins: z.string().optional().nullable(),
  coinPerPointRatio: z.number().positive().optional(),
  rewardEnabled: z.boolean().optional(),
  rewardTitle: z.string().optional().nullable(),
  rewardCost: z.number().int().positive().optional().nullable(),
  rewardCoins: z.number().int().positive().optional().nullable(),
  rewardOnlyWhenLive: z.boolean().optional(),
  // Kick rewards -> coins
  kickRewardEnabled: z.boolean().optional(),
  kickRewardIdForCoins: z.string().optional().nullable(),
  kickCoinPerPointRatio: z.number().positive().optional(),
  kickRewardCoins: z.number().int().positive().optional().nullable(),
  kickRewardOnlyWhenLive: z.boolean().optional(),
  // Trovo spells -> coins
  trovoManaCoinsPerUnit: z.number().int().min(0).optional(),
  trovoElixirCoinsPerUnit: z.number().int().min(0).optional(),
  // VKVideo channel points -> coins
  vkvideoRewardEnabled: z.boolean().optional(),
  vkvideoRewardIdForCoins: z.string().optional().nullable(),
  vkvideoCoinPerPointRatio: z.number().positive().optional(),
  vkvideoRewardCoins: z.number().int().positive().optional().nullable(),
  vkvideoRewardOnlyWhenLive: z.boolean().optional(),
  // YouTube "like stream" -> coins
  youtubeLikeRewardEnabled: z.boolean().optional(),
  youtubeLikeRewardCoins: z.number().int().min(0).optional(),
  youtubeLikeRewardOnlyWhenLive: z.boolean().optional(),
  // Twitch auto rewards (frontend-configured JSONB).
  // null clears config.
  twitchAutoRewards: twitchAutoRewardsSchema.optional().nullable(),
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
  // Boosty integration
  boostyBlogName: z.string().min(1).max(200).optional().nullable(),
  boostyCoinsPerSub: z.number().int().min(0).optional(),
  // Discord guild where Boosty integration issues roles for this channel.
  // null => fall back to DISCORD_DEFAULT_SUBSCRIPTIONS_GUILD_ID (or legacy DISCORD_SUBSCRIPTIONS_GUILD_ID).
  discordSubscriptionsGuildId: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1).max(64)).optional().nullable(),
  // Boosty via Boosty API (tiers): mapping tierKey -> coins.
  // Stored in DB as JSONB array of objects [{ tierKey, coins }, ...]
  boostyTierCoins: z
    .array(
      z.object({
        tierKey: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1).max(120)),
        coins: z.number().int().min(0).max(1_000_000),
      })
    )
    .max(100)
    .optional()
    .nullable(),
  // Boosty via Discord roles (tiers): mapping tier -> Discord role id.
  // Stored in DB as JSONB array of objects [{ tier, roleId }, ...]
  boostyDiscordTierRoles: z
    .array(
      z.object({
        tier: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.string().min(1).max(80)),
        roleId: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1).max(64)),
      })
    )
    .max(50)
    .optional()
    .nullable(),
}).superRefine((obj, ctx) => {
  // Validate boostyTierCoins uniqueness
  const tierCoins = (obj as any)?.boostyTierCoins;
  if (Array.isArray(tierCoins)) {
    const seen = new Set<string>();
    for (let i = 0; i < tierCoins.length; i += 1) {
      const tierKey = normTierKey(tierCoins[i]?.tierKey);
      if (!tierKey) continue;
      if (seen.has(tierKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['boostyTierCoins', i, 'tierKey'],
          message: `Duplicate tierKey (case-insensitive): ${tierKey}`,
        });
      }
      seen.add(tierKey);
    }
  }

  const items = (obj as any)?.boostyDiscordTierRoles;
  if (!Array.isArray(items)) return;

  const seenTier = new Set<string>();
  const seenRoleId = new Set<string>();
  for (let i = 0; i < items.length; i += 1) {
    const tier = String(items[i]?.tier ?? '').trim().toLowerCase();
    const roleId = String(items[i]?.roleId ?? '').trim();
    if (!tier || !roleId) continue;

    if (seenTier.has(tier)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['boostyDiscordTierRoles', i, 'tier'],
        message: 'Tier must be unique',
      });
    }
    if (seenRoleId.has(roleId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['boostyDiscordTierRoles', i, 'roleId'],
        message: 'roleId must be unique',
      });
    }
    seenTier.add(tier);
    seenRoleId.add(roleId);
  }
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

// EventSub: channel.subscribe (v1)
export const twitchSubscribeEventSchema = z
  .object({
    broadcaster_user_id: z.string(),
    broadcaster_user_login: z.string().optional(),
    broadcaster_user_name: z.string().optional(),
    user_id: z.string(),
    user_login: z.string().optional(),
    user_name: z.string(),
    tier: z.string().optional(),
    is_gift: z.boolean().optional(),
    is_prime: z.boolean().optional(),
  })
  .passthrough();

// EventSub: channel.subscription.message (v1)
export const twitchSubscriptionMessageEventSchema = z
  .object({
    broadcaster_user_id: z.string(),
    user_id: z.string(),
    user_name: z.string(),
    tier: z.string().optional(),
    message: z
      .object({
        text: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

// EventSub: channel.subscription.gift (v1)
export const twitchSubscriptionGiftEventSchema = z
  .object({
    broadcaster_user_id: z.string(),
    user_id: z.string().optional().nullable(), // gifter (may be absent for anonymous)
    user_name: z.string().optional().nullable(),
    tier: z.string().optional(),
    total: z.number().int().optional(),
    is_anonymous: z.boolean().optional(),
    recipient_user_id: z.string().optional().nullable(),
    recipient_user_name: z.string().optional().nullable(),
  })
  .passthrough();

// EventSub: channel.cheer (v1)
export const twitchCheerEventSchema = z
  .object({
    broadcaster_user_id: z.string(),
    user_id: z.string().optional().nullable(),
    user_name: z.string().optional().nullable(),
    bits: z.number().int(),
    is_anonymous: z.boolean().optional(),
  })
  .passthrough();

// EventSub: channel.raid (v1)
export const twitchRaidEventSchema = z
  .object({
    from_broadcaster_user_id: z.string(),
    from_broadcaster_user_name: z.string().optional(),
    to_broadcaster_user_id: z.string(),
    viewer_count: z.number().int(),
  })
  .passthrough();

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


