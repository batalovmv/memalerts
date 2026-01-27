import type { Request, Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';

// Prisma typings may lag behind during staged deployments/migrations; use a local escape hatch for optional/newer fields.
export type BotControllerParams = {
  provider?: string;
  id?: string;
};

export type ChatBotOutboxRow = {
  id: string;
  status: string;
  attempts: number | null;
  lastError: string | null;
  processingAt: Date | null;
  sentAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BotSayBody = {
  provider?: string;
  message?: unknown;
  vkvideoChannelId?: string;
  vkvideoChannelUrl?: string | null;
};

export type TwitchEventSubSubscription = {
  type?: string;
  status?: string;
  transport?: { callback?: string };
};


export function requireChannelId(req: AuthRequest, res: Response): string | null {
  const channelId = String(req.channelId || '').trim();
  if (!channelId) {
    res.status(400).json({ error: 'Bad Request', message: 'Missing channelId' });
    return null;
  }
  return channelId;
}

export function normalizeMessage(v: unknown): string {
  return String(v ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
}

export const TWITCH_MESSAGE_MAX_LEN = 500;

export function computeApiBaseUrl(req: Request): string {
  const domain = process.env.DOMAIN || 'twitchmemes.ru';
  const reqHost = req.get('host') || '';
  const allowedHosts = new Set([domain, `www.${domain}`, `beta.${domain}`]);
  return allowedHosts.has(reqHost) ? `https://${reqHost}` : `https://${domain}`;
}

export function isPrismaErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === code;
}

export function formatIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? new Date(value).toISOString() : value.toISOString();
}
