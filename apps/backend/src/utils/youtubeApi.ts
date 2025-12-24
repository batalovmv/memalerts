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

function isExpired(expiresAt: Date | null | undefined, skewSeconds: number): boolean {
  if (!expiresAt) return true;
  const msLeft = expiresAt.getTime() - Date.now();
  return msLeft <= skewSeconds * 1000;
}

export async function getYouTubeExternalAccount(userId: string): Promise<{
  id: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string | null;
} | null> {
  const row = await prisma.externalAccount.findFirst({
    where: { userId, provider: 'youtube' },
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

export async function refreshYouTubeAccessToken(userId: string): Promise<string | null> {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const account = await getYouTubeExternalAccount(userId);
  if (!account?.refreshToken) return null;

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
      logger.warn('youtube.token.refresh_failed', {
        userId,
        status: resp.status,
        error: data?.error || null,
      });
      return null;
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

    return data.access_token;
  } catch (e: any) {
    logger.warn('youtube.token.refresh_failed', { userId, errorMessage: e?.message || String(e) });
    return null;
  }
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
    const reason = json?.error?.message || json?.error_description || text || resp.statusText;
    throw new Error(`YouTube API error: ${resp.status} ${reason}`);
  }
  return json as T;
}

export async function fetchMyYouTubeChannelId(userId: string): Promise<string | null> {
  const accessToken = await getValidYouTubeAccessToken(userId);
  if (!accessToken) return null;

  type Resp = { items?: Array<{ id?: string }> };
  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('part', 'id');
  url.searchParams.set('mine', 'true');

  try {
    const data = await youtubeGetJson<Resp>({ accessToken, url: url.toString() });
    const id = String(data?.items?.[0]?.id || '').trim();
    return id || null;
  } catch (e: any) {
    logger.warn('youtube.channels.mine_failed', { userId, errorMessage: e?.message || String(e) });
    return null;
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


