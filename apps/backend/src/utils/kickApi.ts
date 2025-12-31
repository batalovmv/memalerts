import { prisma } from '../lib/prisma.js';
import { logger } from './logger.js';
import { refreshKickToken } from '../auth/providers/kick.js';

function isExpired(expiresAt: Date | null | undefined, skewSeconds: number): boolean {
  if (!expiresAt) return true;
  const msLeft = expiresAt.getTime() - Date.now();
  return msLeft <= skewSeconds * 1000;
}

export async function getKickExternalAccount(userId: string): Promise<{
  id: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string | null;
  providerAccountId: string;
  login: string | null;
  displayName: string | null;
} | null> {
  const uid = String(userId || '').trim();
  if (!uid) return null;

  const row = await prisma.externalAccount.findFirst({
    where: { userId: uid, provider: 'kick' },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      provider: true,
      providerAccountId: true,
      accessToken: true,
      refreshToken: true,
      tokenExpiresAt: true,
      scopes: true,
      login: true,
      displayName: true,
    },
  });
  if (!row || row.provider !== 'kick') return null;

  return {
    id: row.id,
    accessToken: row.accessToken ? String(row.accessToken) : null,
    refreshToken: row.refreshToken ? String(row.refreshToken) : null,
    tokenExpiresAt: row.tokenExpiresAt ?? null,
    scopes: row.scopes ?? null,
    providerAccountId: row.providerAccountId,
    login: row.login ?? null,
    displayName: row.displayName ?? null,
  };
}

export async function getValidKickAccessTokenByExternalAccountId(externalAccountId: string): Promise<string | null> {
  const id = String(externalAccountId || '').trim();
  if (!id) return null;

  const row = await prisma.externalAccount.findUnique({
    where: { id },
    select: { id: true, provider: true, accessToken: true, refreshToken: true, tokenExpiresAt: true, scopes: true },
  });
  if (!row) return null;
  if (row.provider !== 'kick') return null;

  if (row.accessToken && !isExpired(row.tokenExpiresAt, 60)) {
    return row.accessToken;
  }

  const clientId = String(process.env.KICK_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.KICK_CLIENT_SECRET || '').trim();
  const refreshUrl = String(process.env.KICK_REFRESH_URL || '').trim();
  if (!clientId || !clientSecret || !refreshUrl) return null;
  if (!row.refreshToken) return null;

  try {
    const refresh = await refreshKickToken({
      refreshUrl,
      clientId,
      clientSecret,
      refreshToken: row.refreshToken,
    });
    const accessToken = String(refresh.data?.access_token || '').trim();
    if (!accessToken) {
      logger.warn('kick.token.refresh_failed', {
        externalAccountId: id,
        status: refresh.status,
        error: (refresh.data as any)?.error ?? null,
      });
      return null;
    }

    const refreshTokenNext = String(refresh.data?.refresh_token || '').trim() || null;
    const expiresIn = Number(refresh.data?.expires_in || 0);
    const tokenExpiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;
    const scopes = Array.isArray(refresh.data?.scope) ? refresh.data.scope.join(' ') : (refresh.data?.scope ? String(refresh.data.scope) : null);

    await prisma.externalAccount.update({
      where: { id },
      data: {
        accessToken,
        tokenExpiresAt,
        scopes: scopes ?? row.scopes ?? null,
        ...(refreshTokenNext ? { refreshToken: refreshTokenNext } : {}),
      },
    });

    return accessToken;
  } catch (e: any) {
    logger.warn('kick.token.refresh_failed', { externalAccountId: id, errorMessage: e?.message || String(e) });
    return null;
  }
}

export async function getValidKickBotAccessToken(): Promise<string | null> {
  try {
    const cred = await (prisma as any).globalKickBotCredential.findFirst({
      where: { enabled: true },
      orderBy: { updatedAt: 'desc' },
      select: { externalAccountId: true },
    });
    const externalAccountId = String((cred as any)?.externalAccountId || '').trim();
    if (!externalAccountId) return null;
    return await getValidKickAccessTokenByExternalAccountId(externalAccountId);
  } catch (e: any) {
    if (e?.code !== 'P2021') {
      logger.warn('kick.bot_token.db_credential_lookup_failed', { errorMessage: e?.message || String(e) });
    }
    return null;
  }
}

export async function sendKickChatMessage(params: {
  accessToken: string;
  kickChannelId: string;
  content: string;
  sendChatUrl: string;
}): Promise<{ ok: boolean; status: number; raw: any }> {
  // Endpoint is configured by ENV because Kick API surface may change.
  const body = {
    channel_id: params.kickChannelId,
    content: params.content,
  };
  try {
    const resp = await fetch(params.sendChatUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => null);
    return { ok: resp.ok, status: resp.status, raw: data };
  } catch (e: any) {
    return { ok: false, status: 0, raw: { error: e?.message || String(e) } };
  }
}

const DEFAULT_KICK_EVENTS_SUBSCRIPTIONS_URL = 'https://api.kick.com/public/v1/events/subscriptions';

export async function listKickEventSubscriptions(params: { accessToken: string; url?: string }): Promise<{
  ok: boolean;
  status: number;
  raw: any;
  subscriptions: any[];
}> {
  const url = String(params.url || DEFAULT_KICK_EVENTS_SUBSCRIPTIONS_URL).trim();
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      },
    });
    const data = await resp.json().catch(() => null);
    const subs = (data as any)?.data ?? (data as any)?.subscriptions ?? (data as any)?.data?.subscriptions ?? [];
    return { ok: resp.ok, status: resp.status, raw: data, subscriptions: Array.isArray(subs) ? subs : [] };
  } catch (e: any) {
    return { ok: false, status: 0, raw: { error: e?.message || String(e) }, subscriptions: [] };
  }
}

export async function createKickEventSubscription(params: {
  accessToken: string;
  callbackUrl: string;
  event: string;
  version?: string;
  url?: string;
}): Promise<{ ok: boolean; status: number; raw: any; subscriptionId: string | null }> {
  const url = String(params.url || DEFAULT_KICK_EVENTS_SUBSCRIPTIONS_URL).trim();
  const body: any = {
    event: params.event,
    version: params.version || 'v1',
    callback_url: params.callbackUrl,
  };
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => null);
    const idRaw =
      (data as any)?.data?.subscription_id ??
      (data as any)?.data?.id ??
      (data as any)?.subscription_id ??
      (data as any)?.id ??
      null;
    const subscriptionId = String(idRaw || '').trim() || null;
    return { ok: resp.ok, status: resp.status, raw: data, subscriptionId };
  } catch (e: any) {
    return { ok: false, status: 0, raw: { error: e?.message || String(e) }, subscriptionId: null };
  }
}





