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
  // VKVideo expects scopes separated by comma.
  if (params.scopes?.length) url.searchParams.set('scope', params.scopes.join(','));
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
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier?: string | null;
}): Promise<{ status: number; data: VkVideoTokenResponse; raw: any }> {
  // VKVideo token exchange uses:
  // - POST application/x-www-form-urlencoded
  // - Authorization: Basic base64(client_id:secret)
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
  });
  // If PKCE was used during authorize request, code_verifier must be provided here.
  if (params.codeVerifier) body.set('code_verifier', params.codeVerifier);

  const basic = Buffer.from(`${params.clientId}:${params.clientSecret}`, 'utf8').toString('base64');

  const post = await fetchJsonSafe(params.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body,
  });
  const tokenData = (post.json ?? {}) as VkVideoTokenResponse;
  debugLog('vkvideo.token.exchange', { method: 'POST', status: post.status, hasAccessToken: !!tokenData?.access_token });
  return { status: post.status, data: tokenData, raw: post.json };
}

export async function refreshVkVideoToken(params: {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  redirectUri: string;
}): Promise<{ status: number; data: VkVideoTokenResponse; raw: any }> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    redirect_uri: params.redirectUri,
  });

  const basic = Buffer.from(`${params.clientId}:${params.clientSecret}`, 'utf8').toString('base64');
  const post = await fetchJsonSafe(params.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body,
  });
  const tokenData = (post.json ?? {}) as VkVideoTokenResponse;
  debugLog('vkvideo.token.refresh', { method: 'POST', status: post.status, hasAccessToken: !!tokenData?.access_token });
  return { status: post.status, data: tokenData, raw: post.json };
}

export async function fetchVkVideoUser(params: {
  userInfoUrl?: string | null;
  accessToken: string;
}): Promise<{ status: number; user: VkVideoUser | null; raw: any }> {
  if (!params.userInfoUrl) return { status: 0, user: null, raw: null };

  const resp = await fetch(params.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
    },
  });
  const data = (await resp.json().catch(() => null)) as any;

  // Extremely defensive mapping: different APIs may use different keys.
  const root =
    // Common wrapper patterns:
    // - { data: { user: {...}, ... } }
    // - { response: {...} }
    // - { result: {...} }
    data?.data ?? data?.response ?? data?.result ?? data?.payload ?? data?.profile ?? data ?? null;

  // If root has nested "user" object (VKVideo Live current_user), prefer it.
  const userRoot = root?.user ?? root?.profile ?? root;

  const id = String(
    userRoot?.id ??
      userRoot?.user_id ??
      userRoot?.sub ??
      root?.id ??
      root?.user_id ??
      root?.sub ??
      data?.id ??
      data?.user_id ??
      data?.sub ??
      ''
  ).trim();
  if (!id) {
    debugLog('vkvideo.user.fetch', { status: resp.status, hasUser: false });
    return { status: resp.status, user: null, raw: data };
  }

  const displayName =
    String(
      userRoot?.display_name ??
        userRoot?.displayName ??
        userRoot?.name ??
        userRoot?.full_name ??
        userRoot?.nickname ??
        userRoot?.nick ??
        userRoot?.username ??
        userRoot?.user_name ??
        ''
    ).trim() ||
    null;
  // If provider returns split name fields, join them (best-effort).
  const displayNameFromParts =
    String([userRoot?.first_name, userRoot?.last_name].filter(Boolean).join(' ')).trim() || null;
  const login =
    String(
      userRoot?.login ??
        userRoot?.screen_name ??
        userRoot?.screenName ??
        userRoot?.email ??
        userRoot?.username ??
        userRoot?.user_name ??
        userRoot?.nickname ??
        ''
    ).trim() || null;
  const avatarUrl =
    String(userRoot?.avatar_url ?? userRoot?.avatarUrl ?? userRoot?.photo_200 ?? userRoot?.picture ?? '').trim() ||
    null;
  const profileUrl = String(userRoot?.profile_url ?? userRoot?.profileUrl ?? userRoot?.url ?? '').trim() || null;

  debugLog('vkvideo.user.fetch', { status: resp.status, hasUser: true, id });
  return {
    status: resp.status,
    user: { id, displayName: displayName ?? displayNameFromParts, login, avatarUrl, profileUrl },
    raw: data,
  };
}


