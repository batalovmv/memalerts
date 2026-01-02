import { prisma } from '../lib/prisma.js';
import { logger } from './logger.js';
import { refreshTrovoToken } from '../auth/providers/trovo.js';

function isExpired(expiresAt: Date | null | undefined, skewSeconds: number): boolean {
  if (!expiresAt) return true;
  const msLeft = expiresAt.getTime() - Date.now();
  return msLeft <= skewSeconds * 1000;
}

export async function getTrovoExternalAccount(userId: string): Promise<{
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
    where: { userId: uid, provider: 'trovo' },
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
  if (!row || row.provider !== 'trovo') return null;

  const accessToken = row.accessToken ? String(row.accessToken) : null;
  const refreshToken = row.refreshToken ? String(row.refreshToken) : null;
  const tokenExpiresAt = row.tokenExpiresAt ?? null;
  const scopes = row.scopes ?? null;

  return {
    id: row.id,
    accessToken,
    refreshToken,
    tokenExpiresAt,
    scopes,
    providerAccountId: row.providerAccountId,
    login: row.login ?? null,
    displayName: row.displayName ?? null,
  };
}

export async function getValidTrovoAccessTokenByExternalAccountId(externalAccountId: string): Promise<string | null> {
  const id = String(externalAccountId || '').trim();
  if (!id) return null;

  const row = await prisma.externalAccount.findUnique({
    where: { id },
    select: { id: true, provider: true, accessToken: true, refreshToken: true, tokenExpiresAt: true, scopes: true },
  });
  if (!row) return null;
  if (row.provider !== 'trovo') return null;

  if (row.accessToken && !isExpired(row.tokenExpiresAt, 60)) {
    return row.accessToken;
  }

  const clientId = String(process.env.TROVO_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.TROVO_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return null;
  if (!row.refreshToken) return null;

  try {
    const refresh = await refreshTrovoToken({
      clientId,
      clientSecret,
      refreshToken: row.refreshToken,
      redirectUri: process.env.TROVO_CALLBACK_URL || undefined,
      refreshUrl: process.env.TROVO_REFRESH_URL || undefined,
    });

    const accessToken = String(refresh.data?.access_token || '').trim();
    if (!accessToken) {
      logger.warn('trovo.token.refresh_failed', {
        externalAccountId: id,
        status: refresh.status,
        error: (refresh.data as any)?.error ?? null,
        message: (refresh.data as any)?.message ?? null,
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
    logger.warn('trovo.token.refresh_failed', { externalAccountId: id, errorMessage: e?.message || String(e) });
    return null;
  }
}

export async function getValidTrovoBotAccessToken(): Promise<string | null> {
  try {
    const cred = await (prisma as any).globalTrovoBotCredential.findFirst({
      where: { enabled: true },
      orderBy: { updatedAt: 'desc' },
      select: { externalAccountId: true },
    });
    const externalAccountId = String((cred as any)?.externalAccountId || '').trim();
    if (!externalAccountId) return null;
    return await getValidTrovoAccessTokenByExternalAccountId(externalAccountId);
  } catch (e: any) {
    if (e?.code !== 'P2021') {
      logger.warn('trovo.bot_token.db_credential_lookup_failed', { errorMessage: e?.message || String(e) });
    }
    return null;
  }
}

export async function fetchTrovoChatToken(params: {
  accessToken: string;
  clientId: string;
  chatTokenUrl?: string;
}): Promise<{ ok: boolean; status: number; token: string | null; raw: any }> {
  const url = params.chatTokenUrl || 'https://open-api.trovo.live/openplatform/chat/token';
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'client-id': params.clientId,
        Authorization: `OAuth ${params.accessToken}`,
      },
    });
    const data = await resp.json().catch(() => null);
    const token = String(data?.data?.token ?? data?.token ?? '').trim() || null;
    return { ok: resp.ok && !!token, status: resp.status, token, raw: data };
  } catch (e: any) {
    return { ok: false, status: 0, token: null, raw: { error: e?.message || String(e) } };
  }
}

export async function sendTrovoChatMessage(params: {
  accessToken: string;
  clientId: string;
  trovoChannelId: string;
  content: string;
  sendChatUrl?: string;
}): Promise<{ ok: boolean; status: number; raw: any }> {
  const url = params.sendChatUrl || 'https://open-api.trovo.live/openplatform/chat/send';
  const body = {
    channel_id: params.trovoChannelId,
    content: params.content,
  };

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'client-id': params.clientId,
        Authorization: `OAuth ${params.accessToken}`,
      },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => null);
    return { ok: resp.ok, status: resp.status, raw: data };
  } catch (e: any) {
    return { ok: false, status: 0, raw: { error: e?.message || String(e) } };
  }
}






