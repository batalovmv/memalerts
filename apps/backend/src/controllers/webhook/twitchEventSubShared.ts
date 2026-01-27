import crypto from 'crypto';
import type { Request, Response } from 'express';

export type RawBodyRequest = Request & { rawBody?: Buffer | string };

export type EventSubContext = {
  req: Request;
  res: Response;
  messageId: string;
  messageTimestamp: string;
  rawBody: string;
  subscriptionType: string;
};

export type ChannelForRedemption = {
  id: string;
  slug: string | null;
  rewardIdForCoins: string | null;
  coinPerPointRatio: number | null;
  rewardOnlyWhenLive: boolean | null;
};

export function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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
