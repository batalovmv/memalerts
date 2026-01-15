import { prisma } from '../lib/prisma.js';

export type PrismaAny = typeof prisma & {
  vkVideoChatBotSubscription: { findMany: (args: unknown) => Promise<unknown[]>; update: (args: unknown) => Promise<unknown> };
  botIntegrationSettings: { findMany: (args: unknown) => Promise<unknown[]> };
  vkVideoBotIntegration: { findUnique: (args: unknown) => Promise<unknown | null> };
  globalVkVideoBotCredential: { findFirst: (args: unknown) => Promise<unknown | null> };
  chatBotCommand: { findMany: (args: unknown) => Promise<unknown[]> };
  channel: { findMany: (args: unknown) => Promise<unknown[]>; findUnique: (args: unknown) => Promise<unknown | null> };
  vkVideoChatBotOutboxMessage: {
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

export function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function utcDayKeyYesterday(d: Date): string {
  const x = new Date(d.getTime() - 24 * 60 * 60 * 1000);
  return utcDayKey(x);
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

export function parseVkVideoRoleStubs(): Map<string, string[]> {
  // Optional dev/beta helper for role-gating until we know real VKVideo role IDs and/or have a stable roles endpoint.
  // Format (JSON):
  // {
  //   "<vkvideoChannelId>": {
  //     "login:<senderLogin>": ["role:moderator"],
  //     "user:<vkvideoUserId>": ["role:vip","role:moderator"]
  //   }
  // }
  //
  // Notes:
  // - keys are case-insensitive for logins; user ids are used as-is
  // - values are arrays of arbitrary strings (your "fake role ids" for now)
  const raw = String(process.env.VKVIDEO_ROLE_STUBS_JSON || '').trim();
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw);
    const out = new Map<string, string[]>();
    if (!parsed || typeof parsed !== 'object') return out;

    for (const [vkvideoChannelIdRaw, mapping] of Object.entries(parsed as Record<string, unknown>)) {
      const vkvideoChannelId = String(vkvideoChannelIdRaw || '').trim();
      if (!vkvideoChannelId || !mapping || typeof mapping !== 'object') continue;

      for (const [kRaw, vRaw] of Object.entries(mapping as Record<string, unknown>)) {
        const k = String(kRaw || '').trim();
        if (!k) continue;

        const list = (Array.isArray(vRaw) ? vRaw : []).map((x) => String(x ?? '').trim()).filter(Boolean);
        if (list.length === 0) continue;

        out.set(`${vkvideoChannelId}:${k.toLowerCase()}`, list);
      }
    }

    return out;
  } catch {
    return new Map();
  }
}
