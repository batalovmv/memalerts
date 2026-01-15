import { logger } from '../utils/logger.js';
import { asRecord, getErrorMessage, normalizeLogin } from './vkvideoChatbotShared.js';

export type ChatCommandRole = 'vip' | 'moderator' | 'subscriber' | 'follower';

export type StreamDurationCfg = {
  enabled: boolean;
  triggerNormalized: string;
  responseTemplate: string | null;
  breakCreditMinutes: number;
  onlyWhenLive: boolean;
};

export function normalizeAllowedUsersList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const login = normalizeLogin(v);
    if (!login) continue;
    if (!out.includes(login)) out.push(login);
  }
  return out;
}

export function normalizeAllowedRolesList(raw: unknown): ChatCommandRole[] {
  // VKVideo chat roles mapping is not implemented yet (platform-specific).
  // We still accept the schema and store it, but will ignore roles for now.
  if (!Array.isArray(raw)) return [];
  const out: ChatCommandRole[] = [];
  for (const v of raw) {
    const role = String(v ?? '')
      .trim()
      .toLowerCase() as ChatCommandRole;
    if (!role) continue;
    if (role !== 'vip' && role !== 'moderator' && role !== 'subscriber' && role !== 'follower') continue;
    if (!out.includes(role)) out.push(role);
  }
  return out;
}

export function normalizeVkVideoAllowedRoleIdsList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const id = String(v ?? '').trim();
    if (!id) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function canTriggerCommand(opts: {
  senderLogin: string | null;
  allowedUsers: string[];
  allowedRoles: ChatCommandRole[];
  vkvideoAllowedRoleIds: string[];
  senderVkVideoRoleIds: string[] | null;
}): boolean {
  const users = opts.allowedUsers || [];
  const roles = opts.allowedRoles || [];
  const vkRoles = opts.vkvideoAllowedRoleIds || [];
  if (users.length === 0 && roles.length === 0 && vkRoles.length === 0) return true;
  if (opts.senderLogin && users.includes(opts.senderLogin)) return true;

  // Legacy Twitch roles are ignored here; VKVideo uses role ids.
  if (vkRoles.length) {
    const senderRoleIds = new Set((opts.senderVkVideoRoleIds || []).filter(Boolean));
    for (const roleId of vkRoles) {
      if (senderRoleIds.has(roleId)) return true;
    }
  }
  return false;
}

export async function postInternalCreditsChatter(
  baseUrl: string,
  payload: { channelSlug: string; userId: string; displayName: string }
) {
  const url = new URL('/internal/credits/chatter', baseUrl);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2_000);
  try {
    await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-memalerts-internal': 'credits-event',
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch (e: unknown) {
    logger.warn('vkvideo_chatbot.internal_post_failed', { errorMessage: getErrorMessage(e) });
  } finally {
    clearTimeout(t);
  }
}

export function parseStreamDurationCfg(raw: string | null | undefined): StreamDurationCfg | null {
  try {
    const s = String(raw || '').trim();
    if (!s) return null;
    const parsed = JSON.parse(s) as unknown;
    const parsedRec = asRecord(parsed);
    const triggerNormalized = String(parsedRec.triggerNormalized ?? parsedRec.trigger ?? '')
      .trim()
      .toLowerCase();
    if (!triggerNormalized) return null;
    const enabled = Boolean(parsedRec.enabled);
    const onlyWhenLive = Boolean(parsedRec.onlyWhenLive);
    const breakCreditMinutesRaw = Number(parsedRec.breakCreditMinutes);
    const breakCreditMinutes = Number.isFinite(breakCreditMinutesRaw)
      ? Math.max(0, Math.min(24 * 60, Math.floor(breakCreditMinutesRaw)))
      : 60;
    const responseTemplate =
      parsedRec.responseTemplate === null ? null : String(parsedRec.responseTemplate ?? '').trim() || null;
    return { enabled, triggerNormalized, responseTemplate, breakCreditMinutes, onlyWhenLive };
  } catch {
    return null;
  }
}
