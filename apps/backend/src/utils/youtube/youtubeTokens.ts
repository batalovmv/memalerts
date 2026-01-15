import { prisma } from '../../lib/prisma.js';
import { logger } from '../logger.js';
import type { GoogleRefreshTokenResponse, YouTubeApiErrorReason, YouTubeBotAuthErrorReason } from './youtubeApiTypes.js';
import { getMissingRequiredScopes } from './youtubeScopes.js';

function isExpired(expiresAt: Date | null | undefined, skewSeconds: number): boolean {
  if (!expiresAt) return true;
  const msLeft = expiresAt.getTime() - Date.now();
  return msLeft <= skewSeconds * 1000;
}

let botTokenCache: { key: string; accessToken: string; expiresAt: number } | null = null;

export async function getValidYouTubeBotAccessToken(): Promise<string | null> {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;

  const now = Date.now();

  try {
    const cred = await prisma.globalYouTubeBotCredential.findFirst({
      where: { enabled: true },
      orderBy: { updatedAt: 'desc' },
      select: { externalAccountId: true },
    });

    const externalAccountId = String(cred?.externalAccountId || '').trim();
    if (externalAccountId) {
      const cacheKey = `db:${externalAccountId}`;
      if (botTokenCache && botTokenCache.key === cacheKey && botTokenCache.expiresAt - now > 60_000) {
        return botTokenCache.accessToken;
      }

      const token = await getValidYouTubeAccessTokenByExternalAccountId(externalAccountId);
      if (token) {
        botTokenCache = { key: cacheKey, accessToken: token, expiresAt: now + 45 * 60_000 };
        return token;
      }
    }
  } catch (error) {
    const err = error as { code?: string; message?: string };
    if (err.code !== 'P2021') {
      logger.warn('youtube.bot_token.db_credential_lookup_failed', { errorMessage: err.message || String(error) });
    }
  }

  const refreshToken = process.env.YOUTUBE_BOT_REFRESH_TOKEN;
  if (!refreshToken) return null;

  const cacheKey = 'env';
  if (botTokenCache && botTokenCache.key === cacheKey && botTokenCache.expiresAt - now > 60_000) {
    return botTokenCache.accessToken;
  }

  try {
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    const data = (await resp.json()) as GoogleRefreshTokenResponse;
    if (!resp.ok || !data?.access_token) {
      const reason: YouTubeBotAuthErrorReason = data?.error === 'invalid_grant' ? 'invalid_grant' : 'refresh_failed';
      logger.warn('youtube.bot_token.refresh_failed', {
        reason,
        status: resp.status,
        error: data?.error || null,
        errorDescription: data?.error_description || null,
      });
      return null;
    }

    const expiresInSec = Number(data.expires_in || 0);
    const expiresAt = now + (Number.isFinite(expiresInSec) && expiresInSec > 0 ? expiresInSec * 1000 : 3_000_000);
    botTokenCache = { key: cacheKey, accessToken: data.access_token, expiresAt };
    return data.access_token;
  } catch (error) {
    const err = error as Error;
    logger.warn('youtube.bot_token.refresh_failed', { errorMessage: err.message || String(error) });
    return null;
  }
}

export async function getYouTubeExternalAccount(userId: string): Promise<{
  id: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string | null;
} | null> {
  const rows = await prisma.externalAccount.findMany({
    where: {
      userId,
      provider: 'youtube',
      youTubeBotIntegration: { is: null },
      globalYouTubeBotCredential: { is: null },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, accessToken: true, refreshToken: true, tokenExpiresAt: true, scopes: true },
  });
  if (!rows.length) return null;

  const pickable = rows.map((r) => ({
    ...r,
    hasRefresh: Boolean(r.refreshToken),
    missingScopes: getMissingRequiredScopes(r.scopes ?? null),
  }));

  const best = pickable.find((r) => r.hasRefresh && r.missingScopes.length === 0) ?? null;
  const scoped = pickable.find((r) => r.missingScopes.length === 0) ?? null;
  const row = best ?? scoped ?? rows[0]!;

  return {
    id: row.id,
    accessToken: row.accessToken ?? null,
    refreshToken: row.refreshToken ?? null,
    tokenExpiresAt: row.tokenExpiresAt ?? null,
    scopes: row.scopes ?? null,
  };
}

export async function refreshYouTubeAccessTokenDetailed(userId: string): Promise<{
  ok: boolean;
  accessToken: string | null;
  reason: YouTubeApiErrorReason | null;
  httpStatus: number | null;
  googleError: string | null;
  googleErrorDescription: string | null;
}> {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      accessToken: null,
      reason: 'missing_oauth_env',
      httpStatus: null,
      googleError: null,
      googleErrorDescription: null,
    };
  }

  const account = await getYouTubeExternalAccount(userId);
  if (!account) {
    return {
      ok: false,
      accessToken: null,
      reason: 'no_external_account',
      httpStatus: null,
      googleError: null,
      googleErrorDescription: null,
    };
  }
  if (!account.refreshToken) {
    return {
      ok: false,
      accessToken: null,
      reason: 'missing_refresh_token',
      httpStatus: null,
      googleError: null,
      googleErrorDescription: null,
    };
  }

  try {
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: account.refreshToken,
      }),
    });

    const data = (await resp.json()) as GoogleRefreshTokenResponse;
    if (!resp.ok || !data?.access_token) {
      const reason: YouTubeApiErrorReason = data?.error === 'invalid_grant' ? 'invalid_grant' : 'refresh_failed';
      logger.warn('youtube.token.refresh_failed', {
        userId,
        status: resp.status,
        error: data?.error || null,
        errorDescription: data?.error_description || null,
      });
      return {
        ok: false,
        accessToken: null,
        reason,
        httpStatus: resp.status,
        googleError: data?.error || null,
        googleErrorDescription: data?.error_description || null,
      };
    }

    const tokenExpiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null;
    await prisma.externalAccount.update({
      where: { id: account.id },
      data: {
        accessToken: data.access_token,
        tokenExpiresAt,
        scopes: data.scope ?? account.scopes ?? null,
      },
      select: { id: true },
    });

    return {
      ok: true,
      accessToken: data.access_token,
      reason: null,
      httpStatus: null,
      googleError: null,
      googleErrorDescription: null,
    };
  } catch (error) {
    const err = error as Error;
    logger.warn('youtube.token.refresh_failed', { userId, errorMessage: err.message || String(error) });
    return {
      ok: false,
      accessToken: null,
      reason: 'refresh_failed',
      httpStatus: null,
      googleError: null,
      googleErrorDescription: null,
    };
  }
}

export async function refreshYouTubeAccessToken(userId: string): Promise<string | null> {
  const r = await refreshYouTubeAccessTokenDetailed(userId);
  return r.ok ? r.accessToken : null;
}

export async function getValidYouTubeAccessToken(userId: string): Promise<string | null> {
  const account = await getYouTubeExternalAccount(userId);
  if (!account) return null;

  if (!account.accessToken || isExpired(account.tokenExpiresAt, 60)) {
    return await refreshYouTubeAccessToken(userId);
  }
  return account.accessToken;
}

export async function getValidYouTubeAccessTokenByExternalAccountId(externalAccountId: string): Promise<string | null> {
  const id = String(externalAccountId || '').trim();
  if (!id) return null;

  const row = await prisma.externalAccount.findUnique({
    where: { id },
    select: { id: true, provider: true, accessToken: true, refreshToken: true, tokenExpiresAt: true, scopes: true },
  });
  if (!row) return null;
  if (row.provider !== 'youtube') return null;

  if (!row.accessToken || isExpired(row.tokenExpiresAt, 60)) {
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    if (!row.refreshToken) return null;

    try {
      const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: row.refreshToken,
        }),
      });

      const data = (await resp.json()) as GoogleRefreshTokenResponse;
      if (!resp.ok || !data?.access_token) {
        logger.warn('youtube.token.refresh_failed', {
          externalAccountId: id,
          status: resp.status,
          error: data?.error || null,
          errorDescription: data?.error_description || null,
        });
        return null;
      }

      const tokenExpiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null;
      await prisma.externalAccount.update({
        where: { id },
        data: {
          accessToken: data.access_token,
          tokenExpiresAt,
          scopes: data.scope ?? row.scopes ?? null,
        },
        select: { id: true },
      });

      return data.access_token;
    } catch (error) {
      const err = error as Error;
      logger.warn('youtube.token.refresh_failed', { externalAccountId: id, errorMessage: err.message || String(error) });
      return null;
    }
  }

  return row.accessToken;
}
