import { prisma } from '../lib/prisma.js';
import type { RoleMode, RoleTag } from './youtubeRoles.js';

export type PrismaAny = typeof prisma & {
  youTubeChatBotSubscription: { findMany: (args: unknown) => Promise<unknown[]> };
  botIntegrationSettings: { findMany: (args: unknown) => Promise<unknown[]> };
  youTubeBotIntegration: { findMany: (args: unknown) => Promise<unknown[]> };
  chatBotCommand: { findMany: (args: unknown) => Promise<unknown[]> };
  youTubeChatBotOutboxMessage: {
    findMany: (args: unknown) => Promise<unknown[]>;
    findUnique: (args: unknown) => Promise<unknown | null>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
    update: (args: unknown) => Promise<unknown>;
  };
};

export const prismaAny = prisma as PrismaAny;

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function getErrorCode(err: unknown): string | undefined {
  const rec = err && typeof err === 'object' ? (err as Record<string, unknown>) : null;
  const code = rec?.['code'];
  return typeof code === 'string' ? code : undefined;
}

export function parseIntSafe(v: unknown, def: number): number {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : def;
}

export function parseBool(raw: unknown): boolean {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

export function normalizeSlug(v: string): string {
  return String(v || '')
    .trim()
    .toLowerCase();
}

export function normalizeMessage(v: unknown): string {
  return String(v ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
}

export type YouTubeStreamDurationCfg = {
  enabled: boolean;
  triggerNormalized: string;
  responseTemplate: string | null;
  breakCreditMinutes: number;
  onlyWhenLive: boolean;
};

export type YouTubeCommandItem = {
  triggerNormalized: string;
  response: string;
  onlyWhenLive: boolean;
  requiredRoleTags: RoleTag[];
  roleMode: RoleMode;
};

export type YouTubeChannelState = {
  channelId: string;
  userId: string;
  youtubeChannelId: string;
  slug: string;
  creditsReconnectWindowMinutes: number;
  streamDurationCfg: YouTubeStreamDurationCfg | null;
  liveChatId: string | null;
  isLive: boolean;
  firstPollAfterLive: boolean;
  pageToken: string | null;
  lastLiveCheckAt: number;
  lastPollAt: number;
  nextPollAtMs?: number;
  pollInFlight: boolean;
  commandsTs: number;
  commands: YouTubeCommandItem[];
  botExternalAccountId: string | null;
};
