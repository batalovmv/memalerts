import type { TwitchHelixResponse, TwitchRequestError } from './twitchApiTypes.js';
import { getAppAccessToken } from './twitchAppToken.js';
import { getCircuitBreaker } from '../circuitBreaker.js';
import { isTransientHttpError } from '../httpErrors.js';
import { fetchWithTimeout, getServiceHttpTimeoutMs } from '../httpTimeouts.js';

const twitchCircuit = getCircuitBreaker('twitch');
const twitchTimeoutMs = getServiceHttpTimeoutMs('TWITCH', 10_000, 1_000, 60_000);

async function requestTwitchJson<T>(url: string, init: RequestInit): Promise<T> {
  return twitchCircuit.execute(
    async () => {
      const response = await fetchWithTimeout({
        url,
        service: 'twitch',
        timeoutMs: twitchTimeoutMs,
        timeoutReason: 'twitch_timeout',
        init,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const err: TwitchRequestError = new Error(
          `Twitch API error: ${response.status} ${response.statusText} - ${errorText}`
        );
        err.status = response.status;
        err.body = errorText;
        throw err;
      }

      return (await response.json()) as T;
    },
    { isFailure: isTransientHttpError }
  );
}

async function requestTwitchNoContent(url: string, init: RequestInit): Promise<void> {
  return twitchCircuit.execute(
    async () => {
      const response = await fetchWithTimeout({
        url,
        service: 'twitch',
        timeoutMs: twitchTimeoutMs,
        timeoutReason: 'twitch_timeout',
        init,
      });

      if (!response.ok && response.status !== 204) {
        const errorText = await response.text();
        const err: TwitchRequestError = new Error(
          `Twitch API error: ${response.status} ${response.statusText} - ${errorText}`
        );
        err.status = response.status;
        err.body = errorText;
        throw err;
      }
    },
    { isFailure: isTransientHttpError }
  );
}

export async function createEventSubSubscription(
  userId: string,
  broadcasterId: string,
  webhookUrl: string,
  secret: string
): Promise<TwitchHelixResponse<unknown>> {
  const accessToken = await getAppAccessToken();
  return requestTwitchJson<TwitchHelixResponse<unknown>>('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      'Client-ID': process.env.TWITCH_CLIENT_ID!,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'channel.channel_points_custom_reward_redemption.add',
      version: '1',
      condition: {
        broadcaster_user_id: broadcasterId,
      },
      transport: {
        method: 'webhook',
        callback: webhookUrl,
        secret: secret,
      },
    }),
  });
}

export async function createEventSubSubscriptionOfType(opts: {
  type: string;
  version?: string;
  broadcasterId: string;
  webhookUrl: string;
  secret: string;
  condition?: Record<string, string>;
}): Promise<TwitchHelixResponse<unknown>> {
  const accessToken = await getAppAccessToken();
  const version = String(opts.version || '1');
  const condition =
    opts.condition && typeof opts.condition === 'object' && Object.keys(opts.condition).length > 0
      ? opts.condition
      : { broadcaster_user_id: opts.broadcasterId };

  return requestTwitchJson<TwitchHelixResponse<unknown>>('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      'Client-ID': process.env.TWITCH_CLIENT_ID!,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: opts.type,
      version,
      condition,
      transport: {
        method: 'webhook',
        callback: opts.webhookUrl,
        secret: opts.secret,
      },
    }),
  });
}

export async function createStreamOnlineEventSubSubscription(opts: {
  broadcasterId: string;
  webhookUrl: string;
  secret: string;
}): Promise<TwitchHelixResponse<unknown>> {
  return createEventSubSubscriptionOfType({
    type: 'stream.online',
    version: '1',
    broadcasterId: opts.broadcasterId,
    webhookUrl: opts.webhookUrl,
    secret: opts.secret,
  });
}

export async function createStreamOfflineEventSubSubscription(opts: {
  broadcasterId: string;
  webhookUrl: string;
  secret: string;
}): Promise<TwitchHelixResponse<unknown>> {
  return createEventSubSubscriptionOfType({
    type: 'stream.offline',
    version: '1',
    broadcasterId: opts.broadcasterId,
    webhookUrl: opts.webhookUrl,
    secret: opts.secret,
  });
}

export async function getEventSubSubscriptions(broadcasterId: string): Promise<TwitchHelixResponse<unknown>> {
  const accessToken = await getAppAccessToken();
  return requestTwitchJson<TwitchHelixResponse<unknown>>(
    `https://api.twitch.tv/helix/eventsub/subscriptions?user_id=${broadcasterId}`,
    {
      method: 'GET',
      headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID!,
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
}

export async function deleteEventSubSubscription(subscriptionId: string): Promise<void> {
  const accessToken = await getAppAccessToken();

  const url = new URL('https://api.twitch.tv/helix/eventsub/subscriptions');
  url.searchParams.set('id', subscriptionId);
  await requestTwitchNoContent(url.toString(), {
    method: 'DELETE',
    headers: {
      'Client-ID': process.env.TWITCH_CLIENT_ID!,
      Authorization: `Bearer ${accessToken}`,
    },
  });
}
