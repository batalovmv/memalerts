import { prisma } from '../lib/prisma.js';
import { logger } from './logger.js';

type GoogleRefreshTokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type YouTubeApiErrorReason =
  | 'missing_oauth_env'
  | 'no_external_account'
  | 'missing_refresh_token'
  | 'missing_scopes'
  | 'invalid_grant'
  | 'refresh_failed'
  | 'api_unauthorized'
  | 'api_forbidden'
  | 'api_youtube_signup_required'
  | 'api_access_not_configured'
  | 'api_quota'
  | 'api_insufficient_permissions'
  | 'api_error'
  | 'unknown';

export type FetchMyYouTubeChannelIdDiagnostics = {
  ok: boolean;
  channelId: string | null;
  reason: YouTubeApiErrorReason | null;
  httpStatus: number | null;
  googleError: string | null;
  googleErrorDescription: string | null;
  youtubeErrorReason: string | null;
  youtubeErrorMessage: string | null;
  requiredScopesMissing: string[] | null;
  accountScopes: string | null;
};

function isExpired(expiresAt: Date | null | undefined, skewSeconds: number): boolean {
  if (!expiresAt) return true;
  const msLeft = expiresAt.getTime() - Date.now();
  return msLeft <= skewSeconds * 1000;
}

function splitScopes(scopes: string | null | undefined): string[] {
  return String(scopes || '')
    .split(/[ ,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// YouTube Data API scopes required for our bot features.
//
// Official docs:
// - liveChatMessages.insert (send message): requires `https://www.googleapis.com/auth/youtube.force-ssl`
//
// Minimal scopes policy:
// - We require ONLY `youtube.force-ssl` to minimize the consent screen.
// - This scope also covers the read access we use (search/videos/liveChatMessages.list).
const REQUIRED_YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube.force-ssl'];

function getMissingRequiredScopes(scopes: string | null | undefined): string[] {
  const set = new Set(splitScopes(scopes));
  return REQUIRED_YOUTUBE_SCOPES.filter((s) => !set.has(s));
}

export async function getYouTubeExternalAccount(userId: string): Promise<{
  id: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string | null;
} | null> {
  // IMPORTANT:
  // Some users can end up with multiple YouTube external accounts over time
  // (e.g. different Google accounts or historical providerAccountId differences).
  // For YouTube bot operations we want the "best" usable account:
  // - Prefer accounts that have a refresh token (so access can be refreshed)
  // - Prefer accounts that have required YouTube Data API scopes
  // - Otherwise, fall back to the most recently created row
  const rows = await prisma.externalAccount.findMany({
    where: { userId, provider: 'youtube' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, accessToken: true, refreshToken: true, tokenExpiresAt: true, scopes: true },
  });
  if (!rows.length) return null;

  const pickable = rows.map((r) => ({
    ...r,
    hasRefresh: Boolean(r.refreshToken),
    missingScopes: getMissingRequiredScopes(r.scopes ?? null),
  }));

  // Best: refresh token + all required scopes
  const best = pickable.find((r) => r.hasRefresh && r.missingScopes.length === 0) ?? null;
  // Next: has required scopes (even if refresh missing, might still work short-term)
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

async function refreshYouTubeAccessTokenDetailed(userId: string): Promise<{
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
    return { ok: false, accessToken: null, reason: 'missing_oauth_env', httpStatus: null, googleError: null, googleErrorDescription: null };
  }

  const account = await getYouTubeExternalAccount(userId);
  if (!account) {
    return { ok: false, accessToken: null, reason: 'no_external_account', httpStatus: null, googleError: null, googleErrorDescription: null };
  }
  if (!account.refreshToken) {
    return { ok: false, accessToken: null, reason: 'missing_refresh_token', httpStatus: null, googleError: null, googleErrorDescription: null };
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

    return { ok: true, accessToken: data.access_token, reason: null, httpStatus: null, googleError: null, googleErrorDescription: null };
  } catch (e: any) {
    logger.warn('youtube.token.refresh_failed', { userId, errorMessage: e?.message || String(e) });
    return { ok: false, accessToken: null, reason: 'refresh_failed', httpStatus: null, googleError: null, googleErrorDescription: null };
  }
}

export async function refreshYouTubeAccessToken(userId: string): Promise<string | null> {
  const r = await refreshYouTubeAccessTokenDetailed(userId);
  return r.ok ? r.accessToken : null;
}

export async function getValidYouTubeAccessToken(userId: string): Promise<string | null> {
  const account = await getYouTubeExternalAccount(userId);
  if (!account) return null;

  // If missing or expired (with skew), refresh.
  if (!account.accessToken || isExpired(account.tokenExpiresAt, 60)) {
    return await refreshYouTubeAccessToken(userId);
  }
  return account.accessToken;
}

class YouTubeHttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public bodyText: string | null,
    public errorMessage: string | null,
    public errorReason: string | null,
  ) {
    super(message);
    this.name = 'YouTubeHttpError';
  }
}

async function youtubeGetJson<T>(params: { accessToken: string; url: string }): Promise<T> {
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
    const errorMessage = (json?.error?.message ? String(json.error.message) : null) || (json?.error_description ? String(json.error_description) : null);
    const errorReason =
      Array.isArray(json?.error?.errors) && json.error.errors[0]?.reason ? String(json.error.errors[0].reason) : null;
    const reasonText = errorMessage || text || resp.statusText;
    throw new YouTubeHttpError(`YouTube API error: ${resp.status} ${reasonText}`, resp.status, text || null, errorMessage, errorReason);
  }
  return json as T;
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

  const missingScopes = getMissingRequiredScopes(account.scopes);
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

  if (!accessToken || isExpired(account.tokenExpiresAt, 60)) {
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
    const id = String(data?.items?.[0]?.id || '').trim();
    return {
      ok: Boolean(id),
      channelId: id || null,
      reason: id ? null : 'api_error',
      httpStatus: null,
      googleError: null,
      googleErrorDescription: null,
      youtubeErrorReason: null,
      youtubeErrorMessage: null,
      requiredScopesMissing: null,
      accountScopes: account.scopes ?? null,
    };
  } catch (e: any) {
    const err = e as any;
    const status = typeof err?.status === 'number' ? (err.status as number) : null;
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
      errorMessage: e?.message || String(e),
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

export async function fetchLiveVideoIdByChannelId(params: { accessToken: string; youtubeChannelId: string }): Promise<string | null> {
  type Resp = { items?: Array<{ id?: { videoId?: string } }> };
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'id');
  url.searchParams.set('channelId', params.youtubeChannelId);
  url.searchParams.set('eventType', 'live');
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', '1');

  const data = await youtubeGetJson<Resp>({ accessToken: params.accessToken, url: url.toString() });
  const videoId = String(data?.items?.[0]?.id?.videoId || '').trim();
  return videoId || null;
}

export async function fetchActiveLiveChatIdByVideoId(params: { accessToken: string; videoId: string }): Promise<string | null> {
  type Resp = { items?: Array<{ liveStreamingDetails?: { activeLiveChatId?: string } }> };
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'liveStreamingDetails');
  url.searchParams.set('id', params.videoId);

  const data = await youtubeGetJson<Resp>({ accessToken: params.accessToken, url: url.toString() });
  const liveChatId = String(data?.items?.[0]?.liveStreamingDetails?.activeLiveChatId || '').trim();
  return liveChatId || null;
}

export type YouTubeLiveChatMessage = {
  id: string;
  snippet?: {
    displayMessage?: string;
    publishedAt?: string;
    type?: string;
  };
  authorDetails?: {
    displayName?: string;
    channelId?: string;
    isChatModerator?: boolean;
    isChatOwner?: boolean;
    isChatSponsor?: boolean;
    isVerified?: boolean;
  };
};

export async function listLiveChatMessages(params: {
  accessToken: string;
  liveChatId: string;
  pageToken?: string | null;
  maxResults?: number;
}): Promise<{ items: YouTubeLiveChatMessage[]; nextPageToken: string | null; pollingIntervalMillis: number }> {
  type Resp = {
    items?: YouTubeLiveChatMessage[];
    nextPageToken?: string;
    pollingIntervalMillis?: number;
  };

  const url = new URL('https://www.googleapis.com/youtube/v3/liveChat/messages');
  url.searchParams.set('part', 'snippet,authorDetails');
  url.searchParams.set('liveChatId', params.liveChatId);
  url.searchParams.set('maxResults', String(Math.max(1, Math.min(200, params.maxResults ?? 200))));
  if (params.pageToken) url.searchParams.set('pageToken', params.pageToken);

  const data = await youtubeGetJson<Resp>({ accessToken: params.accessToken, url: url.toString() });
  const pollingIntervalMillis = Number(data?.pollingIntervalMillis);
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    nextPageToken: data?.nextPageToken ? String(data.nextPageToken) : null,
    pollingIntervalMillis: Number.isFinite(pollingIntervalMillis) ? pollingIntervalMillis : 2_000,
  };
}

export async function sendLiveChatMessage(params: { accessToken: string; liveChatId: string; messageText: string }): Promise<void> {
  const url = new URL('https://www.googleapis.com/youtube/v3/liveChat/messages');
  url.searchParams.set('part', 'snippet');

  const body = {
    snippet: {
      liveChatId: params.liveChatId,
      type: 'textMessageEvent',
      textMessageDetails: { messageText: params.messageText },
    },
  };

  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`YouTube API error: ${resp.status} ${text || resp.statusText}`);
  }
}


