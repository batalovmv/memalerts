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
  channel: { findMany: (args: unknown) => Promise<unknown[]>; findUnique: (args: unknown) => Promise<unknown | null> };
  vkVideoChatBotOutboxMessage: {
    findMany: (args: unknown) => Promise<unknown[]>;
    findUnique: (args: unknown) => Promise<unknown | null>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
    update: (args: unknown) => Promise<unknown>;
  };
};

export const prismaAny = prisma as PrismaAny;
