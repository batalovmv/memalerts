import { prisma } from '../../lib/prisma.js';
import { fetchGoogleTokenInfo } from '../../auth/providers/youtube.js';
import { logger } from '../logger.js';
import type { FetchMyYouTubeChannelIdDiagnostics, YouTubeApiErrorReason } from './youtubeApiTypes.js';
import { getMissingRequiredScopes } from './youtubeScopes.js';
import { asRecord, youtubeGetJson } from './youtubeHttp.js';
import { getYouTubeExternalAccount, refreshYouTubeAccessTokenDetailed } from './youtubeTokens.js';

export async function fetchMyYouTubeChannelIdByAccessToken(accessToken: string): Promise<string | null> {
  const token = String(accessToken || '').trim();
  if (!token) return null;

  type Resp = { items?: Array<{ id?: string }> };
  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('part', 'id');
  url.searchParams.set('mine', 'true');

  try {
    const data = await youtubeGetJson<Resp>({ accessToken: token, url: url.toString() });
    const id = String(data?.items?.[0]?.id || '').trim();
    return id || null;
  } catch {
    return null;
  }
}

export async function fetchMyYouTubeChannelProfileByAccessToken(accessToken: string): Promise<{
  channelId: string | null;
  title: string | null;
  avatarUrl: string | null;
} | null> {
  const token = String(accessToken || '').trim();
  if (!token) return null;

  type Resp = {
    items?: Array<{
      id?: string;
      snippet?: {
        title?: string;
        thumbnails?: Record<string, { url?: string }>;
      };
    }>;
  };

  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('mine', 'true');

  try {
    const data = await youtubeGetJson<Resp>({ accessToken: token, url: url.toString() });
    const item = data?.items?.[0] ?? null;
    const channelId = String(item?.id || '').trim() || null;
    const title = (item?.snippet?.title ? String(item.snippet.title) : '').trim() || null;
    const thumbs = item?.snippet?.thumbnails ?? null;
    const avatarUrl =
      (thumbs?.high?.url ? String(thumbs.high.url) : '').trim() ||
      (thumbs?.medium?.url ? String(thumbs.medium.url) : '').trim() ||
      (thumbs?.default?.url ? String(thumbs.default.url) : '').trim() ||
      null;
    return { channelId, title, avatarUrl };
  } catch {
    return null;
  }
}

export async function fetchYouTubeChannelProfilePublicByChannelId(
  channelId: string
): Promise<{ title: string | null; avatarUrl: string | null } | null> {
  const id = String(channelId || '').trim();
  if (!id) return null;

  const url = new URL('https://www.youtube.com/oembed');
  url.searchParams.set('url', `https://www.youtube.com/channel/${id}`);
  url.searchParams.set('format', 'json');

  try {
    const resp = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!resp.ok) return null;
    const json = (await resp.json().catch(() => null)) as unknown;
    const jsonRecord = asRecord(json);
    const title = String(jsonRecord.title || '').trim() || null;
    const avatarUrl = String(jsonRecord.thumbnail_url || '').trim() || null;
    return { title, avatarUrl };
  } catch {
    return null;
  }
}

export async function fetchMyYouTubeChannelId(userId: string): Promise<string | null> {
  const detailed = await fetchMyYouTubeChannelIdDetailed(userId);
  return detailed.channelId;
}

export async function fetchMyYouTubeChannelIdDetailed(userId: string): Promise<FetchMyYouTubeChannelIdDiagnostics> {
  const account = await getYouTubeExternalAccount(userId);
  if (!account) {
    return {
      ok: false,
      channelId: null,
      reason: 'no_external_account',
      httpStatus: null,
      googleError: null,
      googleErrorDescription: null,
      youtubeErrorReason: null,
      youtubeErrorMessage: null,
      requiredScopesMissing: null,
      accountScopes: null,
    };
  }

  let missingScopes = getMissingRequiredScopes(account.scopes);
  if (missingScopes.length && account.accessToken) {
    const tokenInfo = await fetchGoogleTokenInfo({ accessToken: account.accessToken });
    const tokenInfoMissing = getMissingRequiredScopes(tokenInfo?.scope ?? null);
    if (!tokenInfoMissing.length && tokenInfo?.scope) {
      try {
        await prisma.externalAccount.update({
          where: { id: account.id },
          data: { scopes: tokenInfo.scope },
          select: { id: true },
        });
      } catch (error) {
        logger.warn('youtube.scopes.update_failed', {
          userId,
          externalAccountId: account.id,
          errorMessage: (error as Error).message || String(error),
        });
      }
      missingScopes = [];
    }
  }

  if (missingScopes.length) {
    return {
      ok: false,
      channelId: null,
      reason: 'missing_scopes',
      httpStatus: null,
      googleError: null,
      googleErrorDescription: null,
      youtubeErrorReason: null,
      youtubeErrorMessage: null,
      requiredScopesMissing: missingScopes,
      accountScopes: account.scopes ?? null,
    };
  }

  let accessToken = account.accessToken;
  let refreshDiag: Awaited<ReturnType<typeof refreshYouTubeAccessTokenDetailed>> | null = null;

  if (!accessToken || !account.tokenExpiresAt || account.tokenExpiresAt.getTime() - Date.now() <= 60_000) {
    refreshDiag = await refreshYouTubeAccessTokenDetailed(userId);
    if (!refreshDiag.ok || !refreshDiag.accessToken) {
      return {
        ok: false,
        channelId: null,
        reason: refreshDiag.reason || 'refresh_failed',
        httpStatus: refreshDiag.httpStatus,
        googleError: refreshDiag.googleError,
        googleErrorDescription: refreshDiag.googleErrorDescription,
        youtubeErrorReason: null,
        youtubeErrorMessage: null,
        requiredScopesMissing: null,
        accountScopes: account.scopes ?? null,
      };
    }
    accessToken = refreshDiag.accessToken;
  }

  type Resp = { items?: Array<{ id?: string }> };
  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('part', 'id');
  url.searchParams.set('mine', 'true');

  try {
    const data = await youtubeGetJson<Resp>({ accessToken, url: url.toString() });
    let id = String(data?.items?.[0]?.id || '').trim();

    if (!id) {
      const managedUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
      managedUrl.searchParams.set('part', 'id');
      managedUrl.searchParams.set('managedByMe', 'true');
      try {
        const managed = await youtubeGetJson<Resp>({ accessToken, url: managedUrl.toString() });
        id = String(managed?.items?.[0]?.id || '').trim();
      } catch {
        // ignore
      }
    }
    return {
      ok: Boolean(id),
      channelId: id || null,
      reason: id ? null : 'api_youtube_signup_required',
      httpStatus: null,
      googleError: null,
      googleErrorDescription: null,
      youtubeErrorReason: null,
      youtubeErrorMessage: null,
      requiredScopesMissing: null,
      accountScopes: account.scopes ?? null,
    };
  } catch (error) {
    const err = error as { status?: number; errorReason?: string; errorMessage?: string; message?: string };
    const status = typeof err?.status === 'number' ? err.status : null;
    const youtubeErrorReason = typeof err?.errorReason === 'string' ? err.errorReason : null;
    const youtubeErrorMessage = typeof err?.errorMessage === 'string' ? err.errorMessage : null;

    let reason: YouTubeApiErrorReason = 'api_error';
    if (status === 401) reason = 'api_unauthorized';
    if (status === 403) {
      reason = 'api_forbidden';
      if (youtubeErrorReason === 'quotaExceeded' || youtubeErrorReason === 'dailyLimitExceeded') reason = 'api_quota';
      if (youtubeErrorReason === 'insufficientPermissions') reason = 'api_insufficient_permissions';
      if (youtubeErrorReason === 'youtubeSignupRequired') reason = 'api_youtube_signup_required';
      if (youtubeErrorReason === 'accessNotConfigured') reason = 'api_access_not_configured';
    }

    logger.warn('youtube.channels.mine_failed', {
      userId,
      reason,
      status,
      youtubeErrorReason,
      youtubeErrorMessage,
      errorMessage: err?.message || String(error),
    });

    return {
      ok: false,
      channelId: null,
      reason,
      httpStatus: status,
      googleError: refreshDiag?.googleError ?? null,
      googleErrorDescription: refreshDiag?.googleErrorDescription ?? null,
      youtubeErrorReason,
      youtubeErrorMessage,
      requiredScopesMissing: null,
      accountScopes: account.scopes ?? null,
    };
  }
}
