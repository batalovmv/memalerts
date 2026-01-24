import { z } from 'zod';

export const twitchEventSubMessageSchema = z.object({
  subscription: z.object({
    id: z.string(),
    type: z.string(),
    version: z.string(),
    status: z.string(),
    condition: z.record(z.unknown()),
    transport: z.object({
      method: z.string(),
      callback: z.string().optional(),
    }),
    created_at: z.string(),
  }),
  event: z.record(z.unknown()),
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
