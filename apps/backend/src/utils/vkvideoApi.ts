import { prisma } from '../lib/prisma.js';
import { logger } from './logger.js';
import { refreshVkVideoToken } from '../auth/providers/vkvideo.js';

function isExpired(expiresAt: Date | null | undefined, skewSeconds: number): boolean {
  if (!expiresAt) return true;
  const msLeft = expiresAt.getTime() - Date.now();
  return msLeft <= skewSeconds * 1000;
}

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

export async function getValidVkVideoAccessTokenByExternalAccountId(externalAccountId: string): Promise<string | null> {
  const id = String(externalAccountId || '').trim();
  if (!id) return null;

  const row = await prisma.externalAccount.findUnique({
    where: { id },
    select: { id: true, provider: true, accessToken: true, refreshToken: true, tokenExpiresAt: true, scopes: true },
  });
  if (!row) return null;
  if (row.provider !== 'vkvideo') return null;

  if (row.accessToken && !isExpired(row.tokenExpiresAt, 60)) {
    return row.accessToken;
  }

  const clientId = process.env.VKVIDEO_CLIENT_ID;
  const clientSecret = process.env.VKVIDEO_CLIENT_SECRET;
  const tokenUrl = process.env.VKVIDEO_TOKEN_URL;
  const redirectUri = process.env.VKVIDEO_CALLBACK_URL;
  if (!clientId || !clientSecret || !tokenUrl || !redirectUri) return null;
  if (!row.refreshToken) return null;

  try {
    const refreshed = await refreshVkVideoToken({
      tokenUrl,
      clientId,
      clientSecret,
      refreshToken: row.refreshToken,
      redirectUri,
    });

    const accessToken = String(refreshed.data?.access_token || '').trim();
    if (!accessToken) {
      logger.warn('vkvideo.token.refresh_failed', {
        externalAccountId: id,
        status: refreshed.status,
        error: refreshed.data?.error || null,
        errorDescription: refreshed.data?.error_description || null,
      });
      return null;
    }

    const tokenExpiresAt = refreshed.data.expires_in ? new Date(Date.now() + Number(refreshed.data.expires_in) * 1000) : null;

    const refreshTokenNext = String(refreshed.data?.refresh_token || '').trim() || null;
    const scopes =
      Array.isArray(refreshed.data?.scope) ? refreshed.data.scope.join(' ') : refreshed.data?.scope ? String(refreshed.data.scope) : null;

    await prisma.externalAccount.update({
      where: { id },
      data: {
        accessToken,
        tokenExpiresAt,
        scopes: scopes ?? row.scopes ?? null,
        ...(refreshTokenNext ? { refreshToken: refreshTokenNext } : {}),
      },
      select: { id: true },
    });

    return accessToken;
  } catch (e: any) {
    logger.warn('vkvideo.token.refresh_failed', { externalAccountId: id, errorMessage: e?.message || String(e) });
    return null;
  }
}

export async function getValidVkVideoBotAccessToken(): Promise<string | null> {
  // Prefer DB-stored global credential (admin-linked default bot)
  try {
    const cred = await (prisma as any).globalVkVideoBotCredential.findFirst({
      where: { enabled: true },
      orderBy: { updatedAt: 'desc' },
      select: { externalAccountId: true },
    });

    const externalAccountId = String((cred as any)?.externalAccountId || '').trim();
    if (!externalAccountId) return null;
    return await getValidVkVideoAccessTokenByExternalAccountId(externalAccountId);
  } catch (e: any) {
    // Feature not deployed yet
    if (e?.code !== 'P2021') {
      logger.warn('vkvideo.bot_token.db_credential_lookup_failed', { errorMessage: e?.message || String(e) });
    }
    return null;
  }
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

async function vkvideoGetJson(params: {
  accessToken: string;
  url: string;
}): Promise<{ ok: boolean; status: number; data: any; error: string | null }> {
  try {
    const resp = await fetch(params.url, {
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
    return { ok: false, status: 0, data: null, error: e?.message || String(e) };
  }
}

async function vkvideoPostJson(params: {
  accessToken: string;
  url: string;
  body: any;
}): Promise<{ ok: boolean; status: number; data: any; error: string | null }> {
  try {
    const resp = await fetch(params.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params.body ?? {}),
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
    return { ok: false, status: 0, data: null, error: e?.message || String(e) };
  }
}

export async function fetchVkVideoChannel(params: {
  accessToken: string;
  channelUrl: string;
  apiBaseUrl?: string | null;
}): Promise<{ ok: boolean; status: number; streamId: string | null; webSocketChannels: any | null; data: any; error: string | null }> {
  const apiBaseUrl = (params.apiBaseUrl ?? guessVkVideoApiBaseUrl())?.replace(/\/+$/g, '') || null;
  if (!apiBaseUrl) {
    return { ok: false, status: 0, streamId: null, webSocketChannels: null, data: null, error: 'VKVIDEO_API_BASE_URL is not configured' };
  }
  const url = new URL(`${apiBaseUrl}/v1/channel`);
  url.searchParams.set('channel_url', String(params.channelUrl));
  const r = await vkvideoGetJson({ accessToken: params.accessToken, url: url.toString() });
  if (!r.ok) return { ok: false, status: r.status, streamId: null, webSocketChannels: null, data: r.data, error: r.error };
  const root = r.data?.data ?? r.data ?? null;
  const streamId = String(root?.stream?.id || '').trim() || null;
  const webSocketChannels = root?.channel?.web_socket_channels ?? null;
  return { ok: true, status: r.status, streamId, webSocketChannels, data: r.data, error: null };
}

export async function fetchVkVideoWebsocketToken(params: {
  accessToken: string;
  apiBaseUrl?: string | null;
}): Promise<{ ok: boolean; status: number; token: string | null; data: any; error: string | null }> {
  const apiBaseUrl = (params.apiBaseUrl ?? guessVkVideoApiBaseUrl())?.replace(/\/+$/g, '') || null;
  if (!apiBaseUrl) {
    return { ok: false, status: 0, token: null, data: null, error: 'VKVIDEO_API_BASE_URL is not configured' };
  }
  const url = `${apiBaseUrl}/v1/websocket/token`;
  const r = await vkvideoGetJson({ accessToken: params.accessToken, url });
  if (!r.ok) return { ok: false, status: r.status, token: null, data: r.data, error: r.error };
  const token = String(r.data?.data?.token || '').trim() || null;
  return { ok: Boolean(token), status: r.status, token, data: r.data, error: token ? null : 'missing_token' };
}

export async function fetchVkVideoWebsocketSubscriptionTokens(params: {
  accessToken: string;
  channels: string[];
  apiBaseUrl?: string | null;
}): Promise<{ ok: boolean; status: number; tokensByChannel: Map<string, string>; data: any; error: string | null }> {
  const apiBaseUrl = (params.apiBaseUrl ?? guessVkVideoApiBaseUrl())?.replace(/\/+$/g, '') || null;
  if (!apiBaseUrl) {
    return { ok: false, status: 0, tokensByChannel: new Map(), data: null, error: 'VKVIDEO_API_BASE_URL is not configured' };
  }
  const chans = Array.from(new Set((params.channels || []).map((c) => String(c || '').trim()).filter(Boolean)));
  const url = new URL(`${apiBaseUrl}/v1/websocket/subscription_token`);
  if (chans.length) url.searchParams.set('channels', chans.join(','));
  const r = await vkvideoGetJson({ accessToken: params.accessToken, url: url.toString() });
  if (!r.ok) return { ok: false, status: r.status, tokensByChannel: new Map(), data: r.data, error: r.error };
  const list = Array.isArray(r.data?.data?.channel_tokens) ? r.data.data.channel_tokens : [];
  const map = new Map<string, string>();
  for (const item of list) {
    const channel = String(item?.channel || '').trim();
    const token = String(item?.token || '').trim();
    if (channel && token) map.set(channel, token);
  }
  return { ok: true, status: r.status, tokensByChannel: map, data: r.data, error: null };
}

export async function sendVkVideoChatMessage(params: {
  accessToken: string;
  channelUrl: string;
  streamId: string;
  text: string;
  apiBaseUrl?: string | null;
}): Promise<{ ok: boolean; status: number; data: any; error: string | null }> {
  const apiBaseUrl = (params.apiBaseUrl ?? guessVkVideoApiBaseUrl())?.replace(/\/+$/g, '') || null;
  if (!apiBaseUrl) {
    return { ok: false, status: 0, data: null, error: 'VKVIDEO_API_BASE_URL is not configured' };
  }

  const url = new URL(`${apiBaseUrl}/v1/chat/message/send`);
  url.searchParams.set('channel_url', String(params.channelUrl));
  url.searchParams.set('stream_id', String(params.streamId));

  const body = {
    parts: [
      {
        text: { content: String(params.text || '').trim() },
      },
    ],
  };

  return await vkvideoPostJson({ accessToken: params.accessToken, url: url.toString(), body });
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

  const hasChannelPlaceholder = /\{channelId\}|\{channelUrl\}/.test(templateRaw);
  const hasUserPlaceholder = /\{userId\}/.test(templateRaw);
  if (!hasChannelPlaceholder || !hasUserPlaceholder) {
    return {
      ok: false,
      status: 0,
      roleIds: [],
      data: null,
      error: 'VKVIDEO_CHANNEL_ROLES_USER_URL_TEMPLATE must include {channelId} (or {channelUrl}) and {userId} placeholders',
    };
  }

  const url = templateRaw
    // Back-compat: accept {channelUrl} placeholder name too.
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

export async function fetchVkVideoChannelPointBalance(params: {
  accessToken: string;
  channelUrl: string;
  apiBaseUrl?: string | null;
}): Promise<{ ok: boolean; status: number; balance: any | null; currency: any | null; data: any; error: string | null }> {
  const apiBaseUrl = (params.apiBaseUrl ?? guessVkVideoApiBaseUrl())?.replace(/\/+$/g, '') || null;
  if (!apiBaseUrl) {
    return { ok: false, status: 0, balance: null, currency: null, data: null, error: 'VKVIDEO_API_BASE_URL is not configured' };
  }
  const url = new URL(`${apiBaseUrl}/v1/channel_point`);
  url.searchParams.set('channel_url', String(params.channelUrl));

  const r = await vkvideoGetJson({ accessToken: params.accessToken, url: url.toString() });
  if (!r.ok) return { ok: false, status: r.status, balance: null, currency: null, data: r.data, error: r.error };

  const root = r.data?.data ?? r.data ?? null;
  const balance = root?.balance ?? null;
  const currency = root?.currency ?? root?.channel_point ?? null;
  return { ok: true, status: r.status, balance, currency, data: r.data, error: null };
}

export async function fetchVkVideoChannelPointRewards(params: {
  accessToken: string;
  channelUrl: string;
  apiBaseUrl?: string | null;
}): Promise<{ ok: boolean; status: number; rewards: any[]; data: any; error: string | null }> {
  const apiBaseUrl = (params.apiBaseUrl ?? guessVkVideoApiBaseUrl())?.replace(/\/+$/g, '') || null;
  if (!apiBaseUrl) {
    return { ok: false, status: 0, rewards: [], data: null, error: 'VKVIDEO_API_BASE_URL is not configured' };
  }
  const url = new URL(`${apiBaseUrl}/v1/channel_point/rewards`);
  url.searchParams.set('channel_url', String(params.channelUrl));

  const r = await vkvideoGetJson({ accessToken: params.accessToken, url: url.toString() });
  if (!r.ok) return { ok: false, status: r.status, rewards: [], data: r.data, error: r.error };

  const root = r.data?.data ?? r.data ?? null;
  const rewards =
    (Array.isArray(root?.rewards) ? root.rewards : null) ?? (Array.isArray(root) ? root : null) ?? (Array.isArray(root?.items) ? root.items : []);
  return { ok: true, status: r.status, rewards, data: r.data, error: null };
}

export async function activateVkVideoChannelReward(params: {
  accessToken: string;
  channelUrl: string;
  rewardId: string;
  message?: string | null;
  apiBaseUrl?: string | null;
}): Promise<{ ok: boolean; status: number; data: any; error: string | null }> {
  const apiBaseUrl = (params.apiBaseUrl ?? guessVkVideoApiBaseUrl())?.replace(/\/+$/g, '') || null;
  if (!apiBaseUrl) {
    return { ok: false, status: 0, data: null, error: 'VKVIDEO_API_BASE_URL is not configured' };
  }

  const url = new URL(`${apiBaseUrl}/v1/channel_point/reward/activate`);
  url.searchParams.set('channel_url', String(params.channelUrl));

  const rewardId = String(params.rewardId || '').trim();
  if (!rewardId) return { ok: false, status: 0, data: null, error: 'missing_reward_id' };

  const messageText = String(params.message ?? '').trim();
  const body = {
    reward: {
      id: rewardId,
      ...(messageText
        ? {
            message: {
              parts: [
                {
                  text: { content: messageText },
                },
              ],
            },
          }
        : {}),
    },
  };

  return await vkvideoPostJson({ accessToken: params.accessToken, url: url.toString(), body });
}


