import { debugLog } from '../../utils/debug.js';

export type VkTokenResponse = {
  access_token?: string;
  expires_in?: number;
  user_id?: number;
  email?: string;
  error?: string;
  error_description?: string;
};

export type VkUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  screen_name?: string;
  photo_200?: string;
};

export function getVkAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: string[];
}): string {
  const url = new URL('https://oauth.vk.com/authorize');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', params.state);
  url.searchParams.set('display', 'page');
  // VK uses comma-separated scopes.
  if (params.scopes?.length) url.searchParams.set('scope', params.scopes.join(','));
  return url.toString();
}

export async function exchangeVkCodeForToken(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<VkTokenResponse> {
  const url = new URL('https://oauth.vk.com/access_token');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('client_secret', params.clientSecret);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('code', params.code);

  const tokenResponse = await fetch(url.toString(), { method: 'GET' });
  const tokenData = (await tokenResponse.json()) as VkTokenResponse;
  debugLog('vk.token.exchange', {
    status: tokenResponse.status,
    hasAccessToken: !!tokenData?.access_token,
    hasUserId: !!tokenData?.user_id,
  });
  return tokenData;
}

export async function fetchVkUser(params: { accessToken: string; userId: number }): Promise<VkUser | null> {
  const url = new URL('https://api.vk.com/method/users.get');
  url.searchParams.set('user_ids', String(params.userId));
  url.searchParams.set('fields', 'photo_200,screen_name');
  url.searchParams.set('access_token', params.accessToken);
  url.searchParams.set('v', '5.131');

  const userResponse = await fetch(url.toString(), { method: 'GET' });
  const data = (await userResponse.json()) as { response?: VkUser[] };
  const vkUser = data?.response?.[0] ?? null;
  debugLog('vk.user.fetch', { status: userResponse.status, hasUser: !!vkUser?.id });
  if (!vkUser?.id) return null;
  return vkUser;
}
