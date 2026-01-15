import crypto from 'crypto';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  twitchAutoRewardsSchema,
  type TwitchAutoRewardsConfig,
  twitchCheerEventSchema,
  twitchFollowEventSchema,
  twitchRaidEventSchema,
  twitchSubscribeEventSchema,
  twitchSubscriptionGiftEventSchema,
  twitchSubscriptionMessageEventSchema,
} from '../../shared/schemas.js';

export type RawBodyRequest = Request & { rawBody?: Buffer | string };

export type EventSubContext = {
  req: Request;
  res: Response;
  messageId: string;
  messageTimestamp: string;
  rawBody: string;
  subscriptionType: string;
};

export type TwitchSubscribeEvent = z.infer<typeof twitchSubscribeEventSchema>;
export type TwitchSubscriptionMessageEvent = z.infer<typeof twitchSubscriptionMessageEventSchema>;
export type TwitchSubscriptionGiftEvent = z.infer<typeof twitchSubscriptionGiftEventSchema>;
export type TwitchCheerEvent = z.infer<typeof twitchCheerEventSchema>;
export type TwitchRaidEvent = z.infer<typeof twitchRaidEventSchema>;

export type TierCoinsMap = Record<string, number | null | undefined> | null | undefined;

export type ChannelForRedemption = {
  id: string;
  slug: string | null;
  rewardIdForCoins: string | null;
  coinPerPointRatio: number | null;
  rewardOnlyWhenLive: boolean | null;
  twitchAutoRewardsJson: unknown;
};

export type ChannelForFollow = {
  id: string;
  slug: string | null;
  followGreetingsEnabled: boolean | null;
  followGreetingTemplate: string | null;
  twitchAutoRewardsJson: unknown;
};

export type ChannelForAutoRewards = {
  id: string;
  slug: string | null;
  twitchAutoRewardsJson: unknown;
};

export type ChannelForCredits = {
  slug: string | null;
  creditsReconnectWindowMinutes: number | null;
  streamDurationCommandJson: string | null;
};

export function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function readTierCoins(map: TierCoinsMap, tierKey: string): number {
  const key = String(tierKey || '').trim();
  if (!key || !map) return 0;
  const value = Number(map[key]);
  const result = Number.isFinite(value) ? value : 0;
  return result > 0 ? Math.floor(result) : 0;
}

export function parseTwitchAutoRewards(payload: unknown): TwitchAutoRewardsConfig | null {
  if (!payload || typeof payload !== 'object') return null;
  try {
    return twitchAutoRewardsSchema.parse(payload);
  } catch {
    return null;
  }
}

export function parseEventSubTimestampToMs(raw: string): number | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
