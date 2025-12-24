import { prisma } from '../lib/prisma.js';
import { logger } from './logger.js';

export async function getVkVideoExternalAccount(userId: string): Promise<{
  id: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string | null;
} | null> {
  const row = await prisma.externalAccount.findFirst({
    where: { userId, provider: 'vkvideo' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, accessToken: true, refreshToken: true, tokenExpiresAt: true, scopes: true },
  });
  if (!row) return null;
  return {
    id: row.id,
    accessToken: row.accessToken ?? null,
    refreshToken: row.refreshToken ?? null,
    tokenExpiresAt: row.tokenExpiresAt ?? null,
    scopes: row.scopes ?? null,
  };
}

export function guessVkVideoApiBaseUrl(): string | null {
  const base = String(process.env.VKVIDEO_API_BASE_URL || '').trim();
  if (base) return base.replace(/\/+$/g, '');

  // Back-compat heuristic: derive from VKVIDEO_USERINFO_URL if present.
  const userInfoUrl = String(process.env.VKVIDEO_USERINFO_URL || '').trim();
  if (!userInfoUrl) return null;
  try {
    const u = new URL(userInfoUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export async function fetchVkVideoCurrentUser(params: {
  accessToken: string;
  apiBaseUrl?: string | null;
}): Promise<{ ok: boolean; status: number; data: any; error: string | null }> {
  const apiBaseUrl = (params.apiBaseUrl ?? guessVkVideoApiBaseUrl())?.replace(/\/+$/g, '') || null;
  if (!apiBaseUrl) {
    return { ok: false, status: 0, data: null, error: 'VKVIDEO_API_BASE_URL is not configured' };
  }

  const url = `${apiBaseUrl}/v1/current_user`;
  try {
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: 'application/json',
      },
    });
    const text = await resp.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!resp.ok) {
      const reason = json?.error_description || json?.error || text || resp.statusText;
      return { ok: false, status: resp.status, data: json, error: `VKVideo API error: ${resp.status} ${reason}` };
    }
    return { ok: true, status: resp.status, data: json, error: null };
  } catch (e: any) {
    logger.warn('vkvideo.current_user.fetch_failed', { errorMessage: e?.message || String(e) });
    return { ok: false, status: 0, data: null, error: e?.message || String(e) };
  }
}

export function extractVkVideoChannelIdFromUrl(rawUrl: string): string | null {
  const s = String(rawUrl || '').trim();
  if (!s) return null;

  // Heuristic: use last non-empty path segment as channel identifier.
  // Works for URLs like:
  // - https://.../channel/12345
  // - https://.../@someSlug
  // - https://.../someSlug
  try {
    const u = new URL(s);
    const parts = u.pathname.split('/').map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1] || '';
    return last ? decodeURIComponent(last) : null;
  } catch {
    const parts = s.split('/').map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1] || '';
    return last || null;
  }
}

export async function fetchVkVideoUserRolesOnChannel(params: {
  accessToken: string;
  vkvideoChannelId: string;
  vkvideoUserId: string;
}): Promise<{ ok: boolean; status: number; roleIds: string[]; data: any; error: string | null }> {
  const templateRaw = String(process.env.VKVIDEO_CHANNEL_ROLES_USER_URL_TEMPLATE || '').trim();
  if (!templateRaw) {
    return { ok: false, status: 0, roleIds: [], data: null, error: 'VKVIDEO_CHANNEL_ROLES_USER_URL_TEMPLATE is not configured' };
  }

  const url = templateRaw
    .replace(/\{channelId\}/g, encodeURIComponent(String(params.vkvideoChannelId)))
    .replace(/\{userId\}/g, encodeURIComponent(String(params.vkvideoUserId)));

  try {
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: 'application/json',
      },
    });
    const text = await resp.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!resp.ok) {
      const reason = json?.error_description || json?.error || text || resp.statusText;
      return { ok: false, status: resp.status, roleIds: [], data: json, error: `VKVideo API error: ${resp.status} ${reason}` };
    }

    const root = json?.data ?? json ?? null;
    const roles = Array.isArray(root?.roles) ? root.roles : [];
    const roleIds = roles
      .map((r: any) => String(r?.id || '').trim())
      .filter(Boolean);
    return { ok: true, status: resp.status, roleIds: Array.from(new Set(roleIds)), data: json, error: null };
  } catch (e: any) {
    logger.warn('vkvideo.channel_roles_user.fetch_failed', { errorMessage: e?.message || String(e) });
    return { ok: false, status: 0, roleIds: [], data: null, error: e?.message || String(e) };
  }
}


