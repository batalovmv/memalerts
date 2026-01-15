import { debugLog } from '../../utils/debug.js';

// Trovo OAuth docs:
// - https://developer.trovo.live/docs/APIs.html
// Authorization endpoint:
//   https://open.trovo.live/page/login.html?client_id=...&response_type=code&scope=...&redirect_uri=...&state=...
// Token exchange endpoint:
//   https://open-api.trovo.live/openplatform/exchangetoken
// Refresh endpoint:
//   https://open-api.trovo.live/openplatform/refreshtoken

export type TrovoTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string; // "OAuth"
  scope?: string | string[];

  // Trovo error format (best-effort)
  error?: string;
  error_description?: string;
  status?: number | string;
  message?: string;
};

export type TrovoUserInfo = {
  // Best-effort mapping; Trovo responses vary across endpoints.
  user_id?: string | number;
  channel_id?: string | number;
  nickname?: string;
  user_name?: string;
  avatar?: string;
  profile_pic?: string;
};

function normalizeScopes(scopes: string[]): string {
  // Trovo docs: scopes separated by plus sign (+).
  // URLSearchParams will encode spaces as +, but we accept explicit "+" join to match docs.
  return scopes
    .map((s) => s.trim())
    .filter(Boolean)
    .join('+');
}

export function getTrovoAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes: string[];
}): string {
  const url = new URL('https://open.trovo.live/page/login.html');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('response_type', 'code');
  if (params.scopes?.length) url.searchParams.set('scope', normalizeScopes(params.scopes));
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  return url.toString();
}

async function fetchJsonSafe(
  url: string,
  init: RequestInit
): Promise<{ status: number; json: unknown; text: string | null }> {
  const resp = await fetch(url, init);
  let json: unknown = null;
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

async function trovoTokenRequest(params: {
  url: string;
  clientId: string;
  clientSecret: string;
  body: Record<string, string>;
}): Promise<{ status: number; data: TrovoTokenResponse; raw: unknown; text: string | null }> {
  // Trovo docs show headers 'client-id' and likely 'client-secret' for token calls.
  // Use JSON body first; if provider expects form-encoded, they usually still accept JSON.
  const post = await fetchJsonSafe(params.url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'client-id': params.clientId,
      'client-secret': params.clientSecret,
    },
    body: JSON.stringify(params.body),
  });

  const tokenData = (post.json ?? {}) as TrovoTokenResponse;
  debugLog('trovo.token.request', { url: params.url, status: post.status, hasAccessToken: !!tokenData?.access_token });
  return { status: post.status, data: tokenData, raw: post.json, text: post.text };
}

export async function exchangeTrovoCodeForToken(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  tokenUrl?: string;
}): Promise<{ status: number; data: TrovoTokenResponse; raw: unknown; text: string | null }> {
  const url = params.tokenUrl || 'https://open-api.trovo.live/openplatform/exchangetoken';
  return await trovoTokenRequest({
    url,
    clientId: params.clientId,
    clientSecret: params.clientSecret,
    body: {
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
    },
  });
}

export async function refreshTrovoToken(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  redirectUri?: string;
  refreshUrl?: string;
}): Promise<{ status: number; data: TrovoTokenResponse; raw: unknown; text: string | null }> {
  const url = params.refreshUrl || 'https://open-api.trovo.live/openplatform/refreshtoken';
  const body: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
  };
  // Some providers require redirect_uri on refresh; keep it best-effort.
  if (params.redirectUri) body.redirect_uri = params.redirectUri;

  return await trovoTokenRequest({
    url,
    clientId: params.clientId,
    clientSecret: params.clientSecret,
    body,
  });
}

export async function fetchTrovoUserInfo(params: {
  clientId: string;
  accessToken: string;
  userInfoUrl?: string;
}): Promise<{ status: number; user: TrovoUserInfo | null; raw: unknown; text: string | null }> {
  const url = params.userInfoUrl || 'https://open-api.trovo.live/openplatform/getuserinfo';
  const post = await fetchJsonSafe(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'client-id': params.clientId,
      Authorization: `OAuth ${params.accessToken}`,
    },
    body: JSON.stringify({}),
  });

  const data = post.json && typeof post.json === 'object' ? (post.json as Record<string, unknown>) : null;
  const rootCandidate = data?.data ?? data?.user ?? data?.userinfo ?? data?.profile ?? data ?? null;
  const root = rootCandidate && typeof rootCandidate === 'object' ? (rootCandidate as Record<string, unknown>) : null;

  const userId = String(root?.['user_id'] ?? root?.['userId'] ?? root?.['uid'] ?? root?.['id'] ?? '').trim();
  if (!userId) {
    debugLog('trovo.userinfo.fetch', { status: post.status, hasUser: false });
    return { status: post.status, user: null, raw: data, text: post.text };
  }

  const channelObj = root?.['channel'];
  const channelId = String(
    root?.['channel_id'] ??
      root?.['channelId'] ??
      root?.['channelID'] ??
      (channelObj && typeof channelObj === 'object' ? (channelObj as Record<string, unknown>)['id'] : '') ??
      ''
  ).trim();
  const nickname =
    String(root?.['nick_name'] ?? root?.['nickname'] ?? root?.['display_name'] ?? root?.['displayName'] ?? '').trim() ||
    undefined;
  const userName =
    String(root?.['user_name'] ?? root?.['username'] ?? root?.['login'] ?? '').trim() || undefined;
  const avatar =
    String(
      root?.['profile_pic'] ??
        root?.['profilePic'] ??
        root?.['avatar'] ??
        root?.['avatar_url'] ??
        root?.['avatarUrl'] ??
        ''
    ).trim() || undefined;

  debugLog('trovo.userinfo.fetch', { status: post.status, hasUser: true, userId });
  return {
    status: post.status,
    user: {
      user_id: userId,
      channel_id: channelId || undefined,
      nickname,
      user_name: userName,
      profile_pic: avatar,
    },
    raw: data,
    text: post.text,
  };
}








