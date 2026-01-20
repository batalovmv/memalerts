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
  trovoChannelId?: string;
  kickChannelId?: string;
};

export type BotCommandBody = {
  trigger?: unknown;
  response?: unknown;
  enabled?: unknown;
  onlyWhenLive?: unknown;
  allowedRoles?: unknown;
  allowedUsers?: unknown;
  vkvideoAllowedRoleIds?: unknown;
};

export type FollowGreetingBody = {
  followGreetingTemplate?: unknown;
};

export type StreamDurationBody = {
  enabled?: unknown;
  trigger?: unknown;
  responseTemplate?: unknown;
  breakCreditMinutes?: unknown;
  onlyWhenLive?: unknown;
};

export type StreamDurationConfig = {
  enabled?: unknown;
  trigger?: unknown;
  responseTemplate?: unknown;
  breakCreditMinutes?: unknown;
  onlyWhenLive?: unknown;
};

export type TwitchEventSubSubscription = {
  type?: string;
  status?: string;
  transport?: { callback?: string };
};

export const CHAT_COMMAND_ALLOWED_ROLES = ['vip', 'moderator', 'subscriber', 'follower'] as const;
export type ChatCommandAllowedRole = (typeof CHAT_COMMAND_ALLOWED_ROLES)[number];
const CHAT_COMMAND_ALLOWED_ROLES_SET = new Set<string>(CHAT_COMMAND_ALLOWED_ROLES);

export const ALLOWED_USERS_MAX_COUNT = 100;
export const TWITCH_LOGIN_MAX_LEN = 25; // Twitch login max length
const TWITCH_LOGIN_RE = /^[a-z0-9_]{1,25}$/;

export const VKVIDEO_ROLE_IDS_MAX_COUNT = 100;
export const VKVIDEO_ROLE_ID_MAX_LEN = 128;

export type BotCommandUpdatePayload = {
  enabled?: boolean;
  onlyWhenLive?: boolean;
  allowedRoles?: ChatCommandAllowedRole[];
  allowedUsers?: string[];
  vkvideoAllowedRoleIds?: string[];
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

export function normalizeTrigger(v: unknown): { trigger: string; triggerNormalized: string } {
  const trigger = String(v ?? '').trim();
  const triggerNormalized = trigger.toLowerCase();
  return { trigger, triggerNormalized };
}

export function normalizeAllowedRoles(raw: unknown): ChatCommandAllowedRole[] | null | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return null;
  const out: ChatCommandAllowedRole[] = [];
  for (const v of raw) {
    const role = String(v ?? '')
      .trim()
      .toLowerCase();
    if (!role) continue;
    if (!CHAT_COMMAND_ALLOWED_ROLES_SET.has(role)) return null;
    if (!out.includes(role as ChatCommandAllowedRole)) out.push(role as ChatCommandAllowedRole);
  }
  return out;
}

export function normalizeAllowedUsers(raw: unknown): string[] | null | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return null;
  if (raw.length > ALLOWED_USERS_MAX_COUNT) return null;
  const out: string[] = [];
  for (const v of raw) {
    const login = String(v ?? '')
      .trim()
      .toLowerCase()
      .replace(/^@+/, '');
    if (!login) continue;
    if (login.length > TWITCH_LOGIN_MAX_LEN) return null;
    if (!TWITCH_LOGIN_RE.test(login)) return null;
    if (!out.includes(login)) out.push(login);
  }
  return out;
}

export function normalizeVkVideoAllowedRoleIds(raw: unknown): string[] | null | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return null;
  if (raw.length > VKVIDEO_ROLE_IDS_MAX_COUNT) return null;
  const out: string[] = [];
  for (const v of raw) {
    const id = String(v ?? '').trim();
    if (!id) continue;
    if (id.length > VKVIDEO_ROLE_ID_MAX_LEN) return null;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export const TWITCH_MESSAGE_MAX_LEN = 500;
export const BOT_TRIGGER_MAX_LEN = 50;
export const BOT_RESPONSE_MAX_LEN = 450;
export const FOLLOW_GREETING_TEMPLATE_MAX_LEN = 450;
export const DEFAULT_FOLLOW_GREETING_TEMPLATE = '??????? ?? ??????, {user}!';
export const STREAM_DURATION_TRIGGER_MAX_LEN = 50;
export const STREAM_DURATION_TEMPLATE_MAX_LEN = 450;
export const DEFAULT_STREAM_DURATION_TRIGGER = '!time';
export const DEFAULT_STREAM_DURATION_TEMPLATE = '????? ??????: {hours}? {minutes}? ({totalMinutes}?)';
export const DEFAULT_BREAK_CREDIT_MINUTES = 60;

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
