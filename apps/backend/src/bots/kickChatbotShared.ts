import { prisma } from '../lib/prisma.js';
export {
  asRecord,
  clampInt,
  getErrorCode,
  getErrorMessage,
  normalizeLogin,
  normalizeMessage,
  normalizeSlug,
  parseBool,
  parseIntSafe,
} from './chatbotSharedUtils.js';

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
