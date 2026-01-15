import type { TwitchTokenResponse } from './twitchApiTypes.js';

export async function getAppAccessToken(): Promise<string> {
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID!,
      client_secret: process.env.TWITCH_CLIENT_SECRET!,
      grant_type: 'client_credentials',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get app access token: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as TwitchTokenResponse;
  const accessToken = String(data.access_token || '').trim();
  if (!accessToken) {
    throw new Error('Failed to get app access token: missing access_token');
  }
  return accessToken;
}
