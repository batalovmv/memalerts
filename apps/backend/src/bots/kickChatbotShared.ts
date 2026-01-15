import { prisma } from '../lib/prisma.js';

export type PrismaAny = typeof prisma & {
  kickChatBotSubscription: { findMany: (args: unknown) => Promise<unknown[]> };
  botIntegrationSettings: { findMany: (args: unknown) => Promise<unknown[]> };
  kickBotIntegration: { findMany: (args: unknown) => Promise<unknown[]> };
  chatBotCommand: { findMany: (args: unknown) => Promise<unknown[]> };
  kickChatBotOutboxMessage: {
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

export function normalizeLogin(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');
}

export type KickCommandItem = {
  triggerNormalized: string;
  response: string;
  onlyWhenLive: boolean;
  allowedUsers: string[];
  allowedRoles: string[];
};

export type KickChannelState = {
  channelId: string;
  userId: string;
  kickChannelId: string;
  slug: string;
  botExternalAccountId: string | null;
  commandsTs: number;
  commands: KickCommandItem[];
  chatCursor: string | null;
};
