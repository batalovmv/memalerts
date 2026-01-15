import { debugLog } from '../../utils/debug.js';

export type TwitchTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string[];
  token_type?: string;
};

export type TwitchHelixUser = {
  id: string;
  login: string;
  display_name: string;
  profile_image_url?: string;
};

export function getTwitchAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes: string[];
}): string {
  const scope = encodeURIComponent(params.scopes.join(' '));
  const redirectUri = encodeURIComponent(params.redirectUri);
  const state = encodeURIComponent(params.state);

  return `https://id.twitch.tv/oauth2/authorize?client_id=${params.clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}`;
}

export async function exchangeTwitchCodeForToken(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<TwitchTokenResponse> {
  const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      grant_type: 'authorization_code',
      redirect_uri: params.redirectUri,
    }),
  });

  const tokenData = (await tokenResponse.json()) as TwitchTokenResponse;
  debugLog('twitch.token.exchange', { status: tokenResponse.status, hasAccessToken: !!tokenData?.access_token });
  return tokenData;
}

export async function fetchTwitchUser(params: {
  accessToken: string;
  clientId: string;
}): Promise<TwitchHelixUser | null> {
  const userResponse = await fetch('https://api.twitch.tv/helix/users', {
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Client-Id': params.clientId,
    },
  });
  const userData = (await userResponse.json()) as { data?: TwitchHelixUser[] };
  const twitchUser = userData?.data?.[0];
  debugLog('twitch.user.fetch', { status: userResponse.status, hasUser: !!twitchUser, id: twitchUser?.id });
  return twitchUser ?? null;
}
