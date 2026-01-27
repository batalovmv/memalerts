import { logger } from '../utils/logger.js';

const ALLOWED_ROLE_KEYS = new Set(['vip', 'moderator']);

export function normalizeAllowedUsersList(raw: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const value = String(entry ?? '')
      .trim()
      .toLowerCase()
      .replace(/^@+/, '');
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function normalizeAllowedRolesList(raw: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const value = String(entry ?? '').trim().toLowerCase();
    if (!value || !ALLOWED_ROLE_KEYS.has(value) || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function normalizeVkVideoAllowedRoleIdsList(raw: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const value = String(entry ?? '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function canTriggerCommand(params: {
  senderLogin: string;
  allowedUsers: string[];
  allowedRoles: string[];
  vkvideoAllowedRoleIds: string[];
  senderVkVideoRoleIds: string[] | null;
}): boolean {
  const senderLogin = String(params.senderLogin || '').trim().toLowerCase();
  const allowedUsers = normalizeAllowedUsersList(params.allowedUsers ?? []);
  const allowedRoles = normalizeAllowedRolesList(params.allowedRoles ?? []);
  const allowedRoleIds = normalizeVkVideoAllowedRoleIdsList(params.vkvideoAllowedRoleIds ?? []);

  if (allowedUsers.length === 0 && allowedRoles.length === 0 && allowedRoleIds.length === 0) return true;
  if (allowedUsers.includes(senderLogin)) return true;

  const senderRoles = Array.isArray(params.senderVkVideoRoleIds) ? params.senderVkVideoRoleIds : [];
  if (allowedRoleIds.length > 0 && senderRoles.some((role) => allowedRoleIds.includes(role))) return true;

  return false;
}

export function parseStreamDurationCfg(raw: string): {
  enabled: boolean;
  triggerNormalized: string;
  responseTemplate: string;
  breakCreditMinutes: number;
  onlyWhenLive: boolean;
} | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const trigger = String(parsed.trigger ?? '').trim();
    const responseTemplate = String(parsed.responseTemplate ?? '').trim();
    if (!trigger || !responseTemplate) return null;

    const enabled = parsed.enabled === undefined ? true : Boolean(parsed.enabled);
    const onlyWhenLive = parsed.onlyWhenLive === undefined ? true : Boolean(parsed.onlyWhenLive);
    const breakCreditMinutes = Number.isFinite(parsed.breakCreditMinutes as number)
      ? Math.max(0, Math.floor(parsed.breakCreditMinutes as number))
      : 0;

    return {
      enabled,
      triggerNormalized: trigger.toLowerCase(),
      responseTemplate,
      breakCreditMinutes,
      onlyWhenLive,
    };
  } catch {
    return null;
  }
}

export async function postInternalCreditsChatter(
  baseUrl: string,
  payload: { channelSlug: string; userId: string; displayName: string }
): Promise<void> {
  const url = `${String(baseUrl || '').replace(/\/+$/g, '')}/internal/credits/chat`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error: unknown) {
    logger.warn('vkvideo_chatbot.internal_post_failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}
