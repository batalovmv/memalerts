import { logger } from '../logger.js';
import { extractErrorReason } from './vkvideoCore.js';

export async function fetchVkVideoUserRolesOnChannel(params: {
  accessToken: string;
  vkvideoChannelId: string;
  vkvideoUserId: string;
}): Promise<{ ok: boolean; status: number; roleIds: string[]; data: unknown; error: string | null }> {
  const templateRaw = String(process.env.VKVIDEO_CHANNEL_ROLES_USER_URL_TEMPLATE || '').trim();
  if (!templateRaw) {
    return {
      ok: false,
      status: 0,
      roleIds: [],
      data: null,
      error: 'VKVIDEO_CHANNEL_ROLES_USER_URL_TEMPLATE is not configured',
    };
  }

  const hasChannelPlaceholder = /\{channelId\}|\{channelUrl\}/.test(templateRaw);
  const hasUserPlaceholder = /\{userId\}/.test(templateRaw);
  if (!hasChannelPlaceholder || !hasUserPlaceholder) {
    return {
      ok: false,
      status: 0,
      roleIds: [],
      data: null,
      error:
        'VKVIDEO_CHANNEL_ROLES_USER_URL_TEMPLATE must include {channelId} (or {channelUrl}) and {userId} placeholders',
    };
  }

  const url = templateRaw
    .replace(/\{channelId\}|\{channelUrl\}/g, encodeURIComponent(String(params.vkvideoChannelId)))
    .replace(/\{userId\}/g, encodeURIComponent(String(params.vkvideoUserId)));

  try {
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: 'application/json',
      },
    });
    const text = await resp.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!resp.ok) {
      const reason = extractErrorReason(json, text || resp.statusText);
      return {
        ok: false,
        status: resp.status,
        roleIds: [],
        data: json,
        error: `VKVideo API error: ${resp.status} ${reason}`,
      };
    }

    const root = (json as Record<string, unknown> | null)?.data ?? json ?? null;
    const rootRecord = root && typeof root === 'object' ? (root as Record<string, unknown>) : null;
    const roles = Array.isArray(rootRecord?.roles) ? (rootRecord?.roles as unknown[]) : [];
    const roleIds = roles
      .map((role) => {
        if (!role || typeof role !== 'object') return '';
        const rec = role as Record<string, unknown>;
        return typeof rec.id === 'string' || typeof rec.id === 'number' ? String(rec.id).trim() : '';
      })
      .filter(Boolean);
    return { ok: true, status: resp.status, roleIds: Array.from(new Set(roleIds)), data: json, error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('vkvideo.channel_roles_user.fetch_failed', { errorMessage: message });
    return { ok: false, status: 0, roleIds: [], data: null, error: message };
  }
}
