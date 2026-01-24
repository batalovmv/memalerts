import { prisma } from '../lib/prisma.js';
import type { RoleMode, RoleTag } from './youtubeRoles.js';
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
  chatBotCommand: { findMany: (args: unknown) => Promise<unknown[]> };
  youTubeChatBotOutboxMessage: {
    findMany: (args: unknown) => Promise<unknown[]>;
    findUnique: (args: unknown) => Promise<unknown | null>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
    update: (args: unknown) => Promise<unknown>;
  };
};

export const prismaAny = prisma as PrismaAny;

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
