import crypto from 'crypto';
import { debugLog } from '../../utils/debug.js';

export type VkVideoTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string | string[];

  // Provider-dependent identifiers (best-effort).
  user_id?: string | number;
  sub?: string;

  error?: string;
  error_description?: string;
};

export type VkVideoUser = {
  id: string;
  displayName?: string | null;
  login?: string | null;
  avatarUrl?: string | null;
  profileUrl?: string | null;
};

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function generatePkceVerifier(bytes = 32): string {
  // base64url without padding
  return base64Url(crypto.randomBytes(bytes));
}

export function pkceChallengeS256(verifier: string): string {
  return base64Url(crypto.createHash('sha256').update(verifier).digest());
}

export function getVkVideoAuthorizeUrl(params: {
  authorizeUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: string[];
  codeChallenge?: string;
}): string {
  const url = new URL(params.authorizeUrl);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', params.state);
  if (params.scopes?.length) url.searchParams.set('scope', params.scopes.join(' '));
  if (params.codeChallenge) {
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

async function fetchJsonSafe(url: string, init: RequestInit): Promise<{ status: number; json: any }> {
  const resp = await fetch(url, init);
  let json: any = null;
  try {
    json = await resp.json();
  } catch {
    json = null;
  }
  return { status: resp.status, json };
}

export async function exchangeVkVideoCodeForToken(params: {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string | null;
  code: string;
  redirectUri: string;
  codeVerifier?: string | null;
}): Promise<VkVideoTokenResponse> {
  // VKVideo endpoints/requirements may differ by environment; we support both POST(form) and GET(query).
  // If POST is not allowed, we retry GET.
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: params.clientId,
    code: params.code,
    redirect_uri: params.redirectUri,
  });
  if (params.clientSecret) body.set('client_secret', params.clientSecret);
  if (params.codeVerifier) body.set('code_verifier', params.codeVerifier);

  const post = await fetchJsonSafe(params.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (post.status !== 405 && post.status !== 404 && post.json) {
    const tokenData = post.json as VkVideoTokenResponse;
    debugLog('vkvideo.token.exchange', { method: 'POST', status: post.status, hasAccessToken: !!tokenData?.access_token });
    return tokenData;
  }

  const getUrl = new URL(params.tokenUrl);
  for (const [k, v] of body.entries()) getUrl.searchParams.set(k, v);
  const get = await fetchJsonSafe(getUrl.toString(), { method: 'GET' });
  const tokenData = (get.json ?? {}) as VkVideoTokenResponse;
  debugLog('vkvideo.token.exchange', { method: 'GET', status: get.status, hasAccessToken: !!tokenData?.access_token });
  return tokenData;
}

export async function fetchVkVideoUser(params: {
  userInfoUrl?: string | null;
  accessToken: string;
}): Promise<VkVideoUser | null> {
  if (!params.userInfoUrl) return null;

  const resp = await fetch(params.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
    },
  });
  const data = (await resp.json().catch(() => null)) as any;

  // Extremely defensive mapping: different APIs may use different keys.
  const id = String(data?.id ?? data?.user_id ?? data?.sub ?? '').trim();
  if (!id) {
    debugLog('vkvideo.user.fetch', { status: resp.status, hasUser: false });
    return null;
  }

  const displayName = String(data?.display_name ?? data?.name ?? data?.username ?? '').trim() || null;
  const login = String(data?.login ?? data?.screen_name ?? data?.email ?? '').trim() || null;
  const avatarUrl = String(data?.avatar_url ?? data?.photo_200 ?? data?.picture ?? '').trim() || null;
  const profileUrl = String(data?.profile_url ?? '').trim() || null;

  debugLog('vkvideo.user.fetch', { status: resp.status, hasUser: true, id });
  return { id, displayName, login, avatarUrl, profileUrl };
}


