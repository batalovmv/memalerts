import type { TwitchHelixResponse, TwitchUser } from './twitchApiTypes.js';
import { twitchApiRequest } from './twitchApiRequest.js';
import { getAppAccessToken } from './twitchAppToken.js';
import { getCircuitBreaker } from '../circuitBreaker.js';
import { isTransientHttpError } from '../httpErrors.js';
import { fetchWithTimeout, getServiceHttpTimeoutMs } from '../httpTimeouts.js';

const twitchCircuit = getCircuitBreaker('twitch');
const twitchTimeoutMs = getServiceHttpTimeoutMs('TWITCH', 10_000, 1_000, 60_000);

export async function getAuthenticatedTwitchUser(
  userId: string
): Promise<{ id: string; display_name?: string | null } | null> {
  const resp = await twitchApiRequest<TwitchHelixResponse<TwitchUser>>('users', 'GET', userId);
  const item = resp?.data?.[0];
  if (!item) return null;
  return { id: String(item.id), display_name: item.display_name ?? null };
}

export async function getChannelInformation(
  userId: string,
  broadcasterId: string
): Promise<{
  broadcaster_type?: string | null;
  _meta?: {
    tokenMode: 'user' | 'app';
    itemKeys?: string[];
    rawBroadcasterType?: unknown;
  };
} | null> {
  try {
    const resp = await twitchApiRequest<TwitchHelixResponse<TwitchUser>>(`users?id=${broadcasterId}`, 'GET', userId);
    const item = resp?.data?.[0];
    if (!item) return null;
    return {
      broadcaster_type: item.broadcaster_type ?? null,
      _meta: {
        tokenMode: 'user',
        itemKeys: typeof item === 'object' && item ? Object.keys(item) : undefined,
        rawBroadcasterType: item.broadcaster_type,
      },
    };
  } catch {
    const accessToken = await getAppAccessToken();
    const resp = await twitchCircuit.execute(
      async () => {
        const response = await fetchWithTimeout({
          url: `https://api.twitch.tv/helix/users?id=${broadcasterId}`,
          service: 'twitch',
          timeoutMs: twitchTimeoutMs,
          timeoutReason: 'twitch_timeout',
          init: {
            method: 'GET',
            headers: {
              'Client-ID': process.env.TWITCH_CLIENT_ID!,
              Authorization: `Bearer ${accessToken}`,
            },
          },
        });
        if (!response.ok) {
          const errorText = await response.text();
          const err = new Error(
            `Twitch API error: ${response.status} ${response.statusText} - ${errorText}`
          ) as Error & { status?: number; body?: string };
          err.status = response.status;
          err.body = errorText;
          throw err;
        }
        return (await response.json()) as TwitchHelixResponse<TwitchUser>;
      },
      { isFailure: isTransientHttpError }
    );
    const item = resp?.data?.[0];
    if (!item) return null;
    return {
      broadcaster_type: item.broadcaster_type ?? null,
      _meta: {
        tokenMode: 'app',
        itemKeys: typeof item === 'object' && item ? Object.keys(item) : undefined,
        rawBroadcasterType: item.broadcaster_type,
      },
    };
  }
}

export async function getTwitchLoginByUserId(twitchUserId: string): Promise<string | null> {
  const id = String(twitchUserId || '').trim();
  if (!id) return null;
  const accessToken = await getAppAccessToken();
  const resp = await twitchCircuit.execute(
    async () => {
      const response = await fetchWithTimeout({
        url: `https://api.twitch.tv/helix/users?id=${encodeURIComponent(id)}`,
        service: 'twitch',
        timeoutMs: twitchTimeoutMs,
        timeoutReason: 'twitch_timeout',
        init: {
          method: 'GET',
          headers: {
            'Client-ID': process.env.TWITCH_CLIENT_ID!,
            Authorization: `Bearer ${accessToken}`,
          },
        },
      });
      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(`Twitch API error: ${response.status} ${response.statusText} - ${errorText}`) as Error & {
          status?: number;
          body?: string;
        };
        err.status = response.status;
        err.body = errorText;
        throw err;
      }
      return (await response.json()) as TwitchHelixResponse<TwitchUser>;
    },
    { isFailure: isTransientHttpError }
  );
  const item = resp?.data?.[0];
  const login = String(item?.login || '')
    .trim()
    .toLowerCase();
  return login || null;
}
