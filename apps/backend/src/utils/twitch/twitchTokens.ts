import { prisma } from '../../lib/prisma.js';
import { logger } from '../logger.js';
import type { TwitchTokenResponse } from './twitchApiTypes.js';

function isExpired(expiresAt: Date | null | undefined, skewSeconds: number): boolean {
  if (!expiresAt) return true;
  const msLeft = expiresAt.getTime() - Date.now();
  return msLeft <= skewSeconds * 1000;
}

export async function getValidTwitchAccessTokenByExternalAccountId(externalAccountId: string): Promise<string | null> {
  const id = String(externalAccountId || '').trim();
  if (!id) return null;

  const row = await prisma.externalAccount.findUnique({
    where: { id },
    select: { id: true, provider: true, accessToken: true, refreshToken: true, tokenExpiresAt: true, scopes: true },
  });
  if (!row) return null;
  if (row.provider !== 'twitch') return null;

  if (row.accessToken && !isExpired(row.tokenExpiresAt, 60)) {
    return row.accessToken;
  }

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  if (!row.refreshToken) return null;

  try {
    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: row.refreshToken,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.warn('twitch.token.refresh_failed', {
        externalAccountId: id,
        status: response.status,
        body: text || null,
      });
      return null;
    }

    const tokenData = (await response.json()) as TwitchTokenResponse;
    const accessToken = String(tokenData?.access_token || '').trim();
    if (!accessToken) return null;

    const refreshTokenNext = String(tokenData?.refresh_token || '').trim() || null;
    const expiresIn = Number(tokenData?.expires_in || 0);
    const tokenExpiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;
    const scopes = Array.isArray(tokenData?.scope)
      ? tokenData.scope.join(' ')
      : tokenData?.scope
        ? String(tokenData.scope)
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
    logger.warn('twitch.token.refresh_failed', {
      externalAccountId: id,
      errorMessage: err.message || String(error),
    });
    return null;
  }
}

export async function getValidTwitchBotAccessToken(): Promise<{ accessToken: string; login: string } | null> {
  try {
    const cred = await prisma.globalTwitchBotCredential.findFirst({
      where: { enabled: true },
      orderBy: { updatedAt: 'desc' },
      select: { externalAccountId: true },
    });
    const externalAccountId = String(cred?.externalAccountId || '').trim();
    if (!externalAccountId) return null;

    const ext = await prisma.externalAccount.findUnique({
      where: { id: externalAccountId },
      select: { id: true, provider: true, login: true },
    });
    const login = String(ext?.login || '')
      .trim()
      .toLowerCase();
    if (!ext || ext.provider !== 'twitch' || !login) return null;

    const accessToken = await getValidTwitchAccessTokenByExternalAccountId(externalAccountId);
    if (!accessToken) return null;
    return { accessToken, login };
  } catch (error) {
    const prismaError = error as { code?: string; message?: string };
    if (prismaError.code !== 'P2021') {
      logger.warn('twitch.bot_token.db_credential_lookup_failed', {
        errorMessage: prismaError.message || String(error),
      });
    }
    return null;
  }
}

export async function getValidAccessToken(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twitchAccessToken: true, twitchRefreshToken: true },
  });

  if (!user || !user.twitchAccessToken) {
    return null;
  }

  return user.twitchAccessToken;
}

export async function refreshAccessToken(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twitchRefreshToken: true },
  });

  if (!user || !user.twitchRefreshToken) {
    return null;
  }

  try {
    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.TWITCH_CLIENT_ID!,
        client_secret: process.env.TWITCH_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: user.twitchRefreshToken,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const tokenData = (await response.json()) as TwitchTokenResponse;

    const accessToken = String(tokenData?.access_token || '').trim();
    if (!accessToken) return null;

    await prisma.user.update({
      where: { id: userId },
      data: {
        twitchAccessToken: accessToken,
        twitchRefreshToken: tokenData.refresh_token || null,
      },
    });

    return accessToken;
  } catch {
    logger.warn('twitch.token.refresh_failed', { userId });
    return null;
  }
}
