import { debugLog } from '../../utils/debug.js';

// Kick OAuth endpoints are configured via ENV to avoid hardcoding potentially changing URLs.
// Expected env vars (see ENV.example):
// - KICK_AUTHORIZE_URL
// - KICK_TOKEN_URL
// - KICK_REFRESH_URL
// - KICK_USERINFO_URL

export type KickTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string | string[];

  error?: string;
  error_description?: string;
};

export type KickUserInfo = {
  id?: string | number;
  user_id?: string | number;
  username?: string;
  user_name?: string;
  display_name?: string;
  name?: string;
  avatar_url?: string;
  avatarUrl?: string;
};

function normalizeScopes(scopes: string[]): string {
  return scopes.map((s) => s.trim()).filter(Boolean).join(' ');
}

export function getKickAuthorizeUrl(params: {
  authorizeUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scopes: string[];
}): string {
  const url = new URL(params.authorizeUrl);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  if (params.scopes?.length) url.searchParams.set('scope', normalizeScopes(params.scopes));
  url.searchParams.set('state', params.state);
  return url.toString();
}

async function fetchJsonSafe(url: string, init: RequestInit): Promise<{ status: number; json: any; text: string | null }> {
  const resp = await fetch(url, init);
  let json: any = null;
  let text: string | null = null;
  try {
    json = await resp.json();
  } catch {
    try {
      text = await resp.text();
    } catch {
      text = null;
    }
  }
  return { status: resp.status, json, text };
}

export async function exchangeKickCodeForToken(params: {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<{ status: number; data: KickTokenResponse; raw: any; text: string | null }> {
  const post = await fetchJsonSafe(params.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    }),
  });
  const tokenData = (post.json ?? {}) as KickTokenResponse;
  debugLog('kick.token.exchange', { status: post.status, hasAccessToken: !!tokenData?.access_token });
  return { status: post.status, data: tokenData, raw: post.json, text: post.text };
}

export async function refreshKickToken(params: {
  refreshUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{ status: number; data: KickTokenResponse; raw: any; text: string | null }> {
  const post = await fetchJsonSafe(params.refreshUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    }),
  });
  const tokenData = (post.json ?? {}) as KickTokenResponse;
  debugLog('kick.token.refresh', { status: post.status, hasAccessToken: !!tokenData?.access_token });
  return { status: post.status, data: tokenData, raw: post.json, text: post.text };
}

export async function fetchKickUser(params: {
  userInfoUrl: string;
  accessToken: string;
}): Promise<{ status: number; user: KickUserInfo | null; raw: any; text: string | null }> {
  const resp = await fetchJsonSafe(params.userInfoUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    },
  });
  const data = resp.json ?? null;
  const root = data?.data ?? data?.user ?? data?.profile ?? data ?? null;
  const id = String(root?.id ?? root?.user_id ?? root?.userId ?? '').trim();
  if (!id) return { status: resp.status, user: null, raw: data, text: resp.text };
  return { status: resp.status, user: root as KickUserInfo, raw: data, text: resp.text };
}









