import { prisma } from '../lib/prisma.js';
export {
  asRecord,
  clampInt,
  getErrorCode,
  getErrorMessage,
  normalizeMessage,
  normalizeSlug,
  parseBool,
  parseIntSafe,
} from './chatbotSharedUtils.js';

export type PrismaAny = typeof prisma & {
  youTubeChatBotSubscription: { findMany: (args: unknown) => Promise<unknown[]> };
  botIntegrationSettings: { findMany: (args: unknown) => Promise<unknown[]> };
  youTubeBotIntegration: { findMany: (args: unknown) => Promise<unknown[]> };
  youTubeChatBotOutboxMessage: {
    findMany: (args: unknown) => Promise<unknown[]>;
    findUnique: (args: unknown) => Promise<unknown | null>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
    update: (args: unknown) => Promise<unknown>;
  };
};

export const prismaAny = prisma as PrismaAny;

export type YouTubeChannelState = {
  channelId: string;
  userId: string;
  youtubeChannelId: string;
  slug: string;
  liveChatId: string | null;
  isLive: boolean;
  lastLiveCheckAt: number;
  botExternalAccountId: string | null;
};
