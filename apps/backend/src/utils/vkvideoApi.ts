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


