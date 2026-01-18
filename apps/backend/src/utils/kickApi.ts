import { prisma } from '../lib/prisma.js';
import { logger } from './logger.js';
import { refreshKickToken, type KickTokenResponse } from '../auth/providers/kick.js';
import { isTransientHttpError } from './httpErrors.js';
import { fetchWithTimeout, getServiceHttpTimeoutMs } from './httpTimeouts.js';
import { getServiceRetryConfig, withRetry } from './retry.js';
import type { KickEventSubscriptionResponse, KickEventSubscriptionsResponse } from './kickApiTypes.js';

export interface KickEventSubscription {
  event?: string;
  type?: string;
  name?: string;
  callback_url?: string;
  callback?: string;
  transport?: {
    callback?: string;
  };
  [key: string]: unknown;
}

const kickTimeoutMs = getServiceHttpTimeoutMs('KICK', 10_000, 1_000, 60_000);
const kickRetryConfig = getServiceRetryConfig('kick', {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 3000,
});

function retryKick<T>(
  action: (attempt: number) => Promise<T>,
  options?: {
    retryOnResult?: (result: T) => boolean;
    isSuccessResult?: (result: T) => boolean;
  }
): Promise<T> {
  return withRetry(action, {
    service: 'kick',
    ...kickRetryConfig,
    retryOnError: isTransientHttpError,
    retryOnResult: options?.retryOnResult,
    isSuccessResult: options?.isSuccessResult,
  });
}

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
        error: (refresh.data as KickTokenResponse)?.error ?? null,
      });
      return null;
    }

    const refreshTokenNext = String(refresh.data?.refresh_token || '').trim() || null;
    const expiresIn = Number(refresh.data?.expires_in || 0);
    const tokenExpiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;
    const scopes = Array.isArray(refresh.data?.scope)
      ? refresh.data.scope.join(' ')
      : refresh.data?.scope
        ? String(refresh.data.scope)
        : null;

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
  } catch (error) {
    const err = error as Error;
    logger.warn('kick.token.refresh_failed', { externalAccountId: id, errorMessage: err.message || String(error) });
    return null;
  }
}

export async function getValidKickBotAccessToken(): Promise<string | null> {
  try {
    const cred = await prisma.globalKickBotCredential.findFirst({
      where: { enabled: true },
      orderBy: { updatedAt: 'desc' },
      select: { externalAccountId: true },
    });
    const externalAccountId = String(cred?.externalAccountId || '').trim();
    if (!externalAccountId) return null;
    return await getValidKickAccessTokenByExternalAccountId(externalAccountId);
  } catch (error) {
    const err = error as { code?: string; message?: string };
    if (err.code !== 'P2021') {
      logger.warn('kick.bot_token.db_credential_lookup_failed', { errorMessage: err.message || String(error) });
    }
    return null;
  }
}

export async function sendKickChatMessage(params: {
  accessToken: string;
  kickChannelId: string;
  content: string;
  sendChatUrl: string;
}): Promise<{ ok: boolean; status: number; raw: unknown; retryAfterSeconds: number | null }> {
  // Kick Dev API (Chat → Post Chat Message) expects:
  // POST https://api.kick.com/public/v1/chat
  // Body: { type: "user"|"bot", content, broadcaster_user_id? }
  // To target a specific channel, we send as "user" and set broadcaster_user_id.
  const broadcasterUserId = Number.parseInt(String(params.kickChannelId || '').trim(), 10);
  if (!Number.isFinite(broadcasterUserId) || broadcasterUserId <= 0) {
    return {
      ok: false,
      status: 400,
      raw: { error: 'Invalid kickChannelId (expected numeric broadcaster_user_id)' },
      retryAfterSeconds: null,
    };
  }

  const contentRaw = String(params.content || '').trim();
  const content = contentRaw.length > 500 ? contentRaw.slice(0, 500) : contentRaw;
  const body = {
    broadcaster_user_id: broadcasterUserId,
    content,
    type: 'user',
  };
  try {
    return await retryKick(
      async () => {
        const resp = await fetchWithTimeout({
          url: params.sendChatUrl,
          service: 'kick',
          timeoutMs: kickTimeoutMs,
          timeoutReason: 'kick_timeout',
          init: {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: `Bearer ${params.accessToken}`,
            },
            body: JSON.stringify(body),
          },
        });
        const data = await resp.json().catch(() => null);
        const retryAfterSeconds = (() => {
          const h = String(resp.headers.get('retry-after') || '').trim();
          if (!h) return null;
          const n = Number.parseInt(h, 10);
          return Number.isFinite(n) && n > 0 ? n : null;
        })();
        return { ok: resp.ok, status: resp.status, raw: data, retryAfterSeconds };
      },
      {
        retryOnResult: (result) => result.status >= 500,
        isSuccessResult: (result) => result.ok,
      }
    );
  } catch (error) {
    const err = error as Error;
    return { ok: false, status: 0, raw: { error: err.message || String(error) }, retryAfterSeconds: null };
  }
}

const DEFAULT_KICK_EVENTS_SUBSCRIPTIONS_URL = 'https://api.kick.com/public/v1/events/subscriptions';

export async function listKickEventSubscriptions(params: { accessToken: string; url?: string }): Promise<{
  ok: boolean;
  status: number;
  raw: unknown;
  subscriptions: KickEventSubscription[];
}> {
  const url = String(params.url || DEFAULT_KICK_EVENTS_SUBSCRIPTIONS_URL).trim();
  try {
    return await retryKick(
      async () => {
        const resp = await fetchWithTimeout({
          url,
          service: 'kick',
          timeoutMs: kickTimeoutMs,
          timeoutReason: 'kick_timeout',
          init: {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${params.accessToken}`,
            },
          },
        });
        const data = (await resp.json().catch(() => null)) as KickEventSubscriptionsResponse | null;
        const dataField = data?.data;
        const subs = Array.isArray(dataField)
          ? dataField
          : dataField && typeof dataField === 'object'
            ? (dataField as { subscriptions?: unknown }).subscriptions ?? data?.subscriptions ?? []
            : data?.subscriptions ?? [];
        const subscriptions =
          Array.isArray(subs) && subs.every((item) => typeof item === 'object' && item !== null)
            ? (subs as KickEventSubscription[])
            : [];
        return { ok: resp.ok, status: resp.status, raw: data, subscriptions };
      },
      {
        retryOnResult: (result) => result.status >= 500,
        isSuccessResult: (result) => result.ok,
      }
    );
  } catch (error) {
    const err = error as Error;
    return { ok: false, status: 0, raw: { error: err.message || String(error) }, subscriptions: [] };
  }
}

export async function createKickEventSubscription(params: {
  accessToken: string;
  callbackUrl: string;
  event: string;
  version?: string;
  url?: string;
}): Promise<{ ok: boolean; status: number; raw: unknown; subscriptionId: string | null }> {
  const url = String(params.url || DEFAULT_KICK_EVENTS_SUBSCRIPTIONS_URL).trim();
  const body = {
    event: params.event,
    version: params.version || 'v1',
    callback_url: params.callbackUrl,
  };
  try {
    return await retryKick(
      async () => {
        const resp = await fetchWithTimeout({
          url,
          service: 'kick',
          timeoutMs: kickTimeoutMs,
          timeoutReason: 'kick_timeout',
          init: {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: `Bearer ${params.accessToken}`,
            },
            body: JSON.stringify(body),
          },
        });
        const data = (await resp.json().catch(() => null)) as KickEventSubscriptionResponse | null;
        const idRaw = data?.data?.subscription_id ?? data?.data?.id ?? data?.subscription_id ?? data?.id ?? null;
        const subscriptionId = String(idRaw || '').trim() || null;
        return { ok: resp.ok, status: resp.status, raw: data, subscriptionId };
      },
      {
        retryOnResult: (result) => result.status >= 500,
        isSuccessResult: (result) => result.ok,
      }
    );
  } catch (error) {
    const err = error as Error;
    return { ok: false, status: 0, raw: { error: err.message || String(error) }, subscriptionId: null };
  }
}
