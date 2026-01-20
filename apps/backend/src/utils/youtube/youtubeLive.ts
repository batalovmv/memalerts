import type { YouTubeLiveChatMessage, YouTubeVideoRating } from './youtubeApiTypes.js';
import { youtubeGetJson } from './youtubeHttp.js';

export async function fetchLiveVideoIdByChannelId(params: {
  accessToken: string;
  youtubeChannelId: string;
}): Promise<string | null> {
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

export async function fetchActiveLiveChatIdByVideoId(params: {
  accessToken: string;
  videoId: string;
}): Promise<string | null> {
  type Resp = { items?: Array<{ liveStreamingDetails?: { activeLiveChatId?: string } }> };
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'liveStreamingDetails');
  url.searchParams.set('id', params.videoId);

  const data = await youtubeGetJson<Resp>({ accessToken: params.accessToken, url: url.toString() });
  const liveChatId = String(data?.items?.[0]?.liveStreamingDetails?.activeLiveChatId || '').trim();
  return liveChatId || null;
}

export async function getYouTubeVideoRating(params: {
  accessToken: string;
  videoId: string;
}): Promise<YouTubeVideoRating> {
  type Resp = { items?: Array<{ videoId?: string; rating?: string }> };
  const url = new URL('https://www.googleapis.com/youtube/v3/videos/getRating');
  url.searchParams.set('id', params.videoId);

  const data = await youtubeGetJson<Resp>({ accessToken: params.accessToken, url: url.toString() });
  const rating = String(data?.items?.[0]?.rating || '')
    .trim()
    .toLowerCase();
  if (rating === 'like' || rating === 'dislike' || rating === 'none' || rating === 'unspecified') return rating;
  return 'unspecified';
}

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

export async function sendLiveChatMessage(params: {
  accessToken: string;
  liveChatId: string;
  messageText: string;
}): Promise<void> {
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
