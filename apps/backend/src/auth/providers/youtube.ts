import { debugLog } from '../../utils/debug.js';

export type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

export type GoogleTokenInfo = {
  // "sub" is commonly present for Google-issued tokens; "user_id" appears in some responses.
  sub?: string;
  user_id?: string;
  scope?: string;
  expires_in?: string;
  email?: string;
  error?: string;
  error_description?: string;
};

export type GoogleUserInfo = {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
};

export function getYouTubeAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes: string[];
  includeGrantedScopes?: boolean;
}): string {
  // We use Google OAuth (OpenID) as YouTube identity.
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', params.scopes.join(' '));
  url.searchParams.set('state', params.state);
  url.searchParams.set('access_type', 'offline'); // refresh_token on first consent
  url.searchParams.set('prompt', 'consent'); // ensure refresh_token for linking
  if (params.includeGrantedScopes) {
    url.searchParams.set('include_granted_scopes', 'true');
  }
  return url.toString();
}

export async function exchangeYouTubeCodeForToken(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<GoogleTokenResponse> {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
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

  const tokenData = (await tokenResponse.json()) as GoogleTokenResponse;
  debugLog('youtube.token.exchange', { status: tokenResponse.status, hasAccessToken: !!tokenData?.access_token });
  return tokenData;
}

export async function fetchYouTubeUser(params: {
  accessToken: string;
}): Promise<GoogleUserInfo | null> {
  const userResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  const data = (await userResponse.json()) as GoogleUserInfo;
  debugLog('youtube.user.fetch', { status: userResponse.status, hasUser: !!data?.sub });
  if (!data?.sub) return null;
  return data;
}

export async function fetchGoogleTokenInfo(params: { accessToken: string }): Promise<GoogleTokenInfo | null> {
  try {
    const url = new URL('https://oauth2.googleapis.com/tokeninfo');
    url.searchParams.set('access_token', params.accessToken);
    const resp = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    const data = (await resp.json()) as GoogleTokenInfo;
    debugLog('google.tokeninfo.fetch', { status: resp.status, hasSub: !!(data?.sub || data?.user_id), hasScope: !!data?.scope });
    if (!resp.ok) return null;
    return data;
  } catch (e: any) {
    debugLog('google.tokeninfo.fetch_error', { errorMessage: e?.message || String(e) });
    return null;
  }
}


