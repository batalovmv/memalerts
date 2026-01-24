import { prisma } from '../lib/prisma.js';
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
} from './chatbotSharedUtils.js';

export type PrismaAny = typeof prisma & {
  vkVideoChatBotSubscription: {
    findMany: (args: unknown) => Promise<unknown[]>;
    update: (args: unknown) => Promise<unknown>;
  };
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
