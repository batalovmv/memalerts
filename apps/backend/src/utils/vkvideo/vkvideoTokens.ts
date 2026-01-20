import { prisma } from '../../lib/prisma.js';
import { logger } from '../logger.js';
import { refreshVkVideoToken } from '../../auth/providers/vkvideo.js';

type GlobalVkVideoBotCredentialClient = {
  globalVkVideoBotCredential?: {
    findFirst: (args: {
      where: { enabled: boolean };
      orderBy: { updatedAt: 'desc' };
      select: { externalAccountId: true };
    }) => Promise<{ externalAccountId: string | null } | null>;
  };
};

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

    const tokenExpiresAt = refreshed.data.expires_in
      ? new Date(Date.now() + Number(refreshed.data.expires_in) * 1000)
      : null;

    const refreshTokenNext = String(refreshed.data?.refresh_token || '').trim() || null;
    const scopes = Array.isArray(refreshed.data?.scope)
      ? refreshed.data.scope.join(' ')
      : refreshed.data?.scope
        ? String(refreshed.data.scope)
        : null;

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
  } catch (error: unknown) {
    logger.warn('vkvideo.token.refresh_failed', {
      externalAccountId: id,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function getValidVkVideoBotAccessToken(): Promise<string | null> {
  try {
    const credClient = prisma as unknown as GlobalVkVideoBotCredentialClient;
    const cred = await credClient.globalVkVideoBotCredential?.findFirst({
      where: { enabled: true },
      orderBy: { updatedAt: 'desc' },
      select: { externalAccountId: true },
    });

    const externalAccountId = String(cred?.externalAccountId || '').trim();
    if (!externalAccountId) return null;
    return await getValidVkVideoAccessTokenByExternalAccountId(externalAccountId);
  } catch (error: unknown) {
    const errorCode = typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;
    if (errorCode !== 'P2021') {
      logger.warn('vkvideo.bot_token.db_credential_lookup_failed', {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }
}
