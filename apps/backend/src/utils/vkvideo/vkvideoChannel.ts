import {
  asRecord,
  guessVkVideoApiBaseUrl,
  vkvideoGetJson,
  vkvideoPostJson,
  type VkVideoApiResult,
} from './vkvideoCore.js';
import type {
  VkVideoChannelResponse,
  VkVideoWebsocketSubscriptionTokensResponse,
  VkVideoWebsocketTokenResponse,
} from './vkvideoApiTypes.js';

export async function fetchVkVideoChannel(params: {
  accessToken: string;
  channelUrl: string;
  apiBaseUrl?: string | null;
}): Promise<{
  ok: boolean;
  status: number;
  streamId: string | null;
  webSocketChannels: unknown | null;
  data: unknown;
  error: string | null;
}> {
  const apiBaseUrl = (params.apiBaseUrl ?? guessVkVideoApiBaseUrl())?.replace(/\/+$/g, '') || null;
  if (!apiBaseUrl) {
    return {
      ok: false,
      status: 0,
      streamId: null,
      webSocketChannels: null,
      data: null,
      error: 'VKVIDEO_API_BASE_URL is not configured',
    };
  }
  const url = new URL(`${apiBaseUrl}/v1/channel`);
  url.searchParams.set('channel_url', String(params.channelUrl));
  const r = await vkvideoGetJson<VkVideoChannelResponse>({ accessToken: params.accessToken, url: url.toString() });
  if (!r.ok)
    return { ok: false, status: r.status, streamId: null, webSocketChannels: null, data: r.data, error: r.error };
  const root = asRecord(r.data)?.data ?? r.data ?? null;
  const rootRecord = (asRecord(root) ?? {}) as Record<string, unknown>;
  const streamRecord = asRecord(rootRecord.stream);
  const streamId = String(streamRecord?.id ?? '').trim() || null;
  const channelRecord = asRecord(rootRecord.channel);
  const webSocketChannels = channelRecord?.web_socket_channels ?? null;
  return { ok: true, status: r.status, streamId, webSocketChannels, data: r.data, error: null };
}

export async function fetchVkVideoWebsocketToken(params: {
  accessToken: string;
  apiBaseUrl?: string | null;
}): Promise<{ ok: boolean; status: number; token: string | null; data: unknown; error: string | null }> {
  const apiBaseUrl = (params.apiBaseUrl ?? guessVkVideoApiBaseUrl())?.replace(/\/+$/g, '') || null;
  if (!apiBaseUrl) {
    return { ok: false, status: 0, token: null, data: null, error: 'VKVIDEO_API_BASE_URL is not configured' };
  }
  const url = `${apiBaseUrl}/v1/websocket/token`;
  const r = await vkvideoGetJson<VkVideoWebsocketTokenResponse>({ accessToken: params.accessToken, url });
  if (!r.ok) return { ok: false, status: r.status, token: null, data: r.data, error: r.error };
  const token = String(r.data?.data?.token ?? '').trim() || null;
  return { ok: Boolean(token), status: r.status, token, data: r.data, error: token ? null : 'missing_token' };
}

export async function fetchVkVideoWebsocketSubscriptionTokens(params: {
  accessToken: string;
  channels: string[];
  apiBaseUrl?: string | null;
}): Promise<{
  ok: boolean;
  status: number;
  tokensByChannel: Map<string, string>;
  data: unknown;
  error: string | null;
}> {
  const apiBaseUrl = (params.apiBaseUrl ?? guessVkVideoApiBaseUrl())?.replace(/\/+$/g, '') || null;
  if (!apiBaseUrl) {
    return {
      ok: false,
      status: 0,
      tokensByChannel: new Map(),
      data: null,
      error: 'VKVIDEO_API_BASE_URL is not configured',
    };
  }
  const chans = Array.from(new Set((params.channels || []).map((c) => String(c || '').trim()).filter(Boolean)));
  const url = new URL(`${apiBaseUrl}/v1/websocket/subscription_token`);
  if (chans.length) url.searchParams.set('channels', chans.join(','));
  const r = await vkvideoGetJson<VkVideoWebsocketSubscriptionTokensResponse>({
    accessToken: params.accessToken,
    url: url.toString(),
  });
  if (!r.ok) return { ok: false, status: r.status, tokensByChannel: new Map(), data: r.data, error: r.error };
  const list = Array.isArray(r.data?.data?.channel_tokens) ? (r.data?.data?.channel_tokens ?? []) : [];
  const map = new Map<string, string>();
  for (const item of list) {
    const channel = String(item?.channel || '').trim();
    const token = String(item?.token || '').trim();
    if (channel && token) map.set(channel, token);
  }
  return { ok: true, status: r.status, tokensByChannel: map, data: r.data, error: null };
}

export async function sendVkVideoChatMessage(params: {
  accessToken: string;
  channelUrl: string;
  streamId: string;
  text: string;
  apiBaseUrl?: string | null;
}): Promise<VkVideoApiResult> {
  const apiBaseUrl = (params.apiBaseUrl ?? guessVkVideoApiBaseUrl())?.replace(/\/+$/g, '') || null;
  if (!apiBaseUrl) {
    return { ok: false, status: 0, data: null, error: 'VKVIDEO_API_BASE_URL is not configured' };
  }

  const url = new URL(`${apiBaseUrl}/v1/chat/message/send`);
  url.searchParams.set('channel_url', String(params.channelUrl));
  url.searchParams.set('stream_id', String(params.streamId));

  const body = {
    parts: [
      {
        text: { content: String(params.text || '').trim() },
      },
    ],
  };

  return await vkvideoPostJson({ accessToken: params.accessToken, url: url.toString(), body });
}
