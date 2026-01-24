import type WebSocket from 'ws';
import { prisma } from '../lib/prisma.js';
import {
  asArray,
  asRecord,
  clampInt,
  getErrorCode,
  getErrorMessage,
  normalizeLogin,
  normalizeMessage,
  normalizeSlug,
  parseBool,
  parseIntSafe,
  utcDayKey,
  utcDayKeyYesterday,
} from './chatbotSharedUtils.js';

export {
  asArray,
  asRecord,
  clampInt,
  getErrorCode,
  getErrorMessage,
  normalizeLogin,
  normalizeMessage,
  normalizeSlug,
  parseBool,
  parseIntSafe,
  utcDayKey,
  utcDayKeyYesterday,
};

export type PrismaAny = typeof prisma & {
  trovoChatBotSubscription: { findMany: (args: unknown) => Promise<unknown[]> };
  botIntegrationSettings: { findMany: (args: unknown) => Promise<unknown[]> };
  trovoBotIntegration: { findMany: (args: unknown) => Promise<unknown[]> };
  chatBotCommand: { findMany: (args: unknown) => Promise<unknown[]> };
  trovoChatBotOutboxMessage: {
    findMany: (args: unknown) => Promise<unknown[]>;
    findUnique: (args: unknown) => Promise<unknown | null>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
    update: (args: unknown) => Promise<unknown>;
  };
};

export const prismaAny = prisma as PrismaAny;

export function safeNum(n: unknown): number {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

export function readTierCoins(map: unknown, tier: string): number {
  if (!map || typeof map !== 'object') return 0;
  const key = String(tier || '').trim();
  const v = asRecord(map)[key];
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export type TrovoCommandItem = {
  triggerNormalized: string;
  response: string;
  onlyWhenLive: boolean;
  allowedUsers: string[];
  allowedRoles: string[]; // stored but ignored for trovo for now
};

export type TrovoChannelState = {
  channelId: string;
  userId: string;
  trovoChannelId: string;
  slug: string;
  ws: WebSocket | null;
  wsToken: string | null;
  wsConnected: boolean;
  wsAuthNonce: string | null;
  wsPingTimer: NodeJS.Timeout | null;
  wsPingGapSeconds: number;
  lastConnectAt: number;
  // Optional per-channel bot account override (ExternalAccount.id)
  botExternalAccountId: string | null;
  // Commands cache
  commandsTs: number;
  commands: TrovoCommandItem[];
};
