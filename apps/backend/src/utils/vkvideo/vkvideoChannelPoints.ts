import {
  asRecord,
  guessVkVideoApiBaseUrl,
  vkvideoGetJson,
  vkvideoPostJson,
  type VkVideoApiResult,
} from './vkvideoCore.js';

export async function fetchVkVideoChannelPointBalance(params: {
  accessToken: string;
  channelUrl: string;
  apiBaseUrl?: string | null;
}): Promise<{
  ok: boolean;
  status: number;
  balance: unknown | null;
  currency: unknown | null;
  data: unknown;
  error: string | null;
}> {
  const apiBaseUrl = (params.apiBaseUrl ?? guessVkVideoApiBaseUrl())?.replace(/\/+$/g, '') || null;
  if (!apiBaseUrl) {
    return {
      ok: false,
      status: 0,
      balance: null,
      currency: null,
      data: null,
      error: 'VKVIDEO_API_BASE_URL is not configured',
    };
  }
  const url = new URL(`${apiBaseUrl}/v1/channel_point`);
  url.searchParams.set('channel_url', String(params.channelUrl));

  const r = await vkvideoGetJson({ accessToken: params.accessToken, url: url.toString() });
  if (!r.ok) return { ok: false, status: r.status, balance: null, currency: null, data: r.data, error: r.error };

  const root = (r.data as Record<string, unknown> | null)?.data ?? r.data ?? null;
  const rootRecord = root && typeof root === 'object' ? (root as Record<string, unknown>) : null;
  const balance = rootRecord?.balance ?? null;
  const currency = rootRecord?.currency ?? rootRecord?.channel_point ?? null;
  return { ok: true, status: r.status, balance, currency, data: r.data, error: null };
}

export async function fetchVkVideoChannelPointRewards(params: {
  accessToken: string;
  channelUrl: string;
  apiBaseUrl?: string | null;
}): Promise<{ ok: boolean; status: number; rewards: unknown[]; data: unknown; error: string | null }> {
  const apiBaseUrl = (params.apiBaseUrl ?? guessVkVideoApiBaseUrl())?.replace(/\/+$/g, '') || null;
  if (!apiBaseUrl) {
    return { ok: false, status: 0, rewards: [], data: null, error: 'VKVIDEO_API_BASE_URL is not configured' };
  }
  const url = new URL(`${apiBaseUrl}/v1/channel_point/rewards`);
  url.searchParams.set('channel_url', String(params.channelUrl));

  const r = await vkvideoGetJson({ accessToken: params.accessToken, url: url.toString() });
  if (!r.ok) return { ok: false, status: r.status, rewards: [], data: r.data, error: r.error };

  const root = (r.data as Record<string, unknown> | null)?.data ?? r.data ?? null;
  const rootRecord = root && typeof root === 'object' ? (root as Record<string, unknown>) : null;
  const rewards =
    (Array.isArray(rootRecord?.rewards) ? (rootRecord?.rewards as unknown[]) : null) ??
    (Array.isArray(root) ? (root as unknown[]) : null) ??
    (Array.isArray(rootRecord?.items) ? (rootRecord?.items as unknown[]) : []);
  return { ok: true, status: r.status, rewards, data: r.data, error: null };
}

export async function activateVkVideoChannelReward(params: {
  accessToken: string;
  channelUrl: string;
  rewardId: string;
  message?: string | null;
  apiBaseUrl?: string | null;
}): Promise<VkVideoApiResult> {
  const apiBaseUrl = (params.apiBaseUrl ?? guessVkVideoApiBaseUrl())?.replace(/\/+$/g, '') || null;
  if (!apiBaseUrl) {
    return { ok: false, status: 0, data: null, error: 'VKVIDEO_API_BASE_URL is not configured' };
  }

  const url = new URL(`${apiBaseUrl}/v1/channel_point/reward/activate`);
  url.searchParams.set('channel_url', String(params.channelUrl));

  const rewardId = String(params.rewardId || '').trim();
  if (!rewardId) return { ok: false, status: 0, data: null, error: 'missing_reward_id' };

  const messageText = String(params.message ?? '').trim();
  const body = {
    reward: {
      id: rewardId,
      ...(messageText
        ? {
            message: {
              parts: [
                {
                  text: { content: messageText },
                },
              ],
            },
          }
        : {}),
    },
  };

  return await vkvideoPostJson({ accessToken: params.accessToken, url: url.toString(), body });
}
