import { debugLog } from '../../utils/debug.js';

export type DiscordTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;

  error?: string;
  error_description?: string;
};

export type DiscordUser = {
  id?: string;
  username?: string;
  global_name?: string | null;
  discriminator?: string;
  avatar?: string | null;
};

function normalizeScopes(scopes: string[]): string {
  return scopes
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');
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

export function getDiscordAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes: string[];
}): string {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('prompt', 'consent');
  if (params.scopes?.length) url.searchParams.set('scope', normalizeScopes(params.scopes));
  url.searchParams.set('state', params.state);
  return url.toString();
}

export async function exchangeDiscordCodeForToken(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  tokenUrl?: string;
}): Promise<{ status: number; data: DiscordTokenResponse; raw: unknown; text: string | null }> {
  const tokenUrl = params.tokenUrl || 'https://discord.com/api/oauth2/token';
  const post = await fetchJsonSafe(tokenUrl, {
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
  const tokenData = (post.json ?? {}) as DiscordTokenResponse;
  debugLog('discord.token.exchange', { status: post.status, hasAccessToken: !!tokenData?.access_token });
  return { status: post.status, data: tokenData, raw: post.json, text: post.text };
}

export async function fetchDiscordUser(params: {
  accessToken: string;
  userInfoUrl?: string;
}): Promise<{ status: number; user: DiscordUser | null; raw: unknown; text: string | null }> {
  const url = params.userInfoUrl || 'https://discord.com/api/users/@me';
  const resp = await fetchJsonSafe(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    },
  });
  const data = resp.json && typeof resp.json === 'object' ? (resp.json as Record<string, unknown>) : null;
  const id = String(data?.id ?? '').trim();
  if (!id) return { status: resp.status, user: null, raw: data, text: resp.text };
  return { status: resp.status, user: data as DiscordUser, raw: data, text: resp.text };
}
