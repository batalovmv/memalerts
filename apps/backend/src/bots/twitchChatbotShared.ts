import type { Client } from 'tmi.js';
import { prisma } from '../lib/prisma.js';

export type PrismaAny = typeof prisma & {
  botIntegrationSettings: { findMany: (args: unknown) => Promise<unknown[]> };
  chatBotCommand: { findMany: (args: unknown) => Promise<unknown[]> };
  channel: { findMany: (args: unknown) => Promise<unknown[]> };
  chatBotOutboxMessage: {
    findMany: (args: unknown) => Promise<unknown[]>;
    findUnique: (args: unknown) => Promise<unknown | null>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
    update: (args: unknown) => Promise<unknown>;
  };
  twitchBotIntegration: { findMany: (args: unknown) => Promise<unknown[]> };
};

export const prismaAny = prisma as PrismaAny;

export type BotClient = {
  kind: 'default' | 'override';
  login: string;
  client: Client;
  joined: Set<string>;
  externalAccountId?: string;
};

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

export function isTwitchAuthError(err: unknown): boolean {
  const message = getErrorMessage(err).toLowerCase();
  if (!message) return false;
  return (
    message.includes('login authentication failed') ||
    message.includes('authentication failed') ||
    message.includes('invalid oauth') ||
    message.includes('invalid token') ||
    message.includes('bad oauth')
  );
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

export function normalizeLogin(v: string): string {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/^#/, '');
}
