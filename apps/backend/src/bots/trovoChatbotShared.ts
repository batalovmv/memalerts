import type WebSocket from 'ws';
import { prisma } from '../lib/prisma.js';

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

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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

export function normalizeLogin(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');
}

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

export function utcDayKey(d: Date): string {
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function utcDayKeyYesterday(d: Date): string {
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 24 * 60 * 60 * 1000);
  return utcDayKey(prev);
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
