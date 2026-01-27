import type { Client } from 'tmi.js';
import { prisma } from '../lib/prisma.js';
import {
  asRecord,
  clampInt,
  getErrorCode,
  getErrorMessage,
  parseBool,
  parseIntSafe,
} from './chatbotSharedUtils.js';

export { asRecord, clampInt, getErrorCode, getErrorMessage, parseBool, parseIntSafe };

export type PrismaAny = typeof prisma & {
  botIntegrationSettings: { findMany: (args: unknown) => Promise<unknown[]> };
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

export function normalizeLogin(v: string): string {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/^#/, '');
}
