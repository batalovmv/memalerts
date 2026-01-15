import type { TwitchHelixResponse } from './twitchApiTypes.js';
import { getValidAccessToken, refreshAccessToken } from './twitchTokens.js';
import { getCircuitBreaker } from '../circuitBreaker.js';
import { isTransientHttpError } from '../httpErrors.js';
import { fetchWithTimeout, getServiceHttpTimeoutMs } from '../httpTimeouts.js';

export async function twitchApiRequest<T = TwitchHelixResponse<unknown>>(
  endpoint: string,
  method: string,
  userId: string,
  body?: Record<string, unknown>
): Promise<T> {
  const circuit = getCircuitBreaker('twitch');
  const timeoutMs = getServiceHttpTimeoutMs('TWITCH', 10_000, 1_000, 60_000);

  const isFailure = (error: unknown) => {
    const err = error as { code?: string; message?: string };
    if (err?.code === 'TWITCH_NO_TOKEN') return false;
    if (String(err?.message || '').includes('No valid access token')) return false;
    return isTransientHttpError(error);
  };

  return circuit.execute(
    async () => {
      let accessToken = await getValidAccessToken(userId);
      if (!accessToken) {
        accessToken = await refreshAccessToken(userId);
        if (!accessToken) {
          const err = new Error('No valid access token available') as Error & { code?: string };
          err.code = 'TWITCH_NO_TOKEN';
          throw err;
        }
      }

      const url = `https://api.twitch.tv/helix/${endpoint}`;
      const options: RequestInit = {
        method,
        headers: {
          'Client-ID': process.env.TWITCH_CLIENT_ID!,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      };

      if (body && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
        options.body = JSON.stringify(body);
      }

      let response = await fetchWithTimeout({
        url,
        service: 'twitch',
        timeoutMs,
        timeoutReason: 'twitch_timeout',
        init: options,
      });

      if (response.status === 401) {
        accessToken = await refreshAccessToken(userId);
        if (accessToken) {
          options.headers = {
            ...options.headers,
            Authorization: `Bearer ${accessToken}`,
          };
          const retryResponse = await fetchWithTimeout({
            url,
            service: 'twitch',
            timeoutMs,
            timeoutReason: 'twitch_timeout',
            init: options,
          });
          if (!retryResponse.ok) {
            const err = new Error(`Twitch API error: ${retryResponse.status} ${retryResponse.statusText}`) as Error & {
              status?: number;
            };
            err.status = retryResponse.status;
            throw err;
          }
          return (await retryResponse.json()) as T;
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `Twitch API error: ${response.status} ${response.statusText} - ${errorText}`
        ) as Error & { status?: number; body?: string };
        err.status = response.status;
        err.body = errorText;
        throw err;
      }

      return (await response.json()) as T;
    },
    { isFailure }
  );
}
