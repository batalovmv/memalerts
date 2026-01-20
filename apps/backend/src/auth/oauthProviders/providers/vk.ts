import { createOAuthState } from '../../oauthState.js';
import { exchangeVkCodeForToken, fetchVkUser, getVkAuthorizeUrl } from '../../providers/vk.js';
import { OAuthProviderError } from '../errors.js';
import type { OAuthProvider } from '../types.js';

export const vkOAuthProvider: OAuthProvider = {
  id: 'vk',
  aliases: ['vkplay'],
  supportsLogin: false,
  supportsLink: true,
  supportsBotLink: false,
  async buildAuthorizeUrl(params) {
    const clientId = process.env.VK_CLIENT_ID;
    const callbackUrl = process.env.VK_CALLBACK_URL;
    const clientSecret = process.env.VK_CLIENT_SECRET;
    if (!clientId || !callbackUrl || !clientSecret) {
      throw new OAuthProviderError('VK OAuth not configured', {
        reason: 'missing_oauth_env',
        provider: 'vk',
        includeProviderParam: true,
      });
    }

    const { state } = await createOAuthState({
      provider: 'vk',
      kind: params.kind,
      userId: params.userId,
      channelId: params.channelId,
      redirectTo: params.redirectTo,
      origin: params.origin,
    });

    const authUrl = getVkAuthorizeUrl({
      clientId,
      redirectUri: callbackUrl,
      state,
      scopes: [],
    });

    return { authUrl };
  },
  async exchangeCode(params) {
    const tokenData = await exchangeVkCodeForToken({
      clientId: process.env.VK_CLIENT_ID!,
      clientSecret: process.env.VK_CLIENT_SECRET!,
      code: params.code,
      redirectUri: process.env.VK_CALLBACK_URL!,
    });

    if (!tokenData.access_token || !tokenData.user_id) {
      throw new OAuthProviderError('No access token/user_id received from VK', { reason: 'no_token', provider: 'vk' });
    }

    const accessToken = tokenData.access_token;
    const refreshToken = null;
    const tokenExpiresAt = tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null;
    const scopes = null;

    const vkUser = await fetchVkUser({ accessToken: tokenData.access_token, userId: tokenData.user_id });
    if (!vkUser) {
      throw new OAuthProviderError('No user data received from VK', { reason: 'no_user', provider: 'vk' });
    }

    const providerAccountId = String(vkUser.id);
    const displayName = [vkUser.first_name, vkUser.last_name].filter(Boolean).join(' ').trim() || null;
    const login = vkUser.screen_name || tokenData.email || null;
    const avatarUrl = vkUser.photo_200 || null;
    const profileUrl = vkUser.screen_name ? `https://vk.com/${vkUser.screen_name}` : `https://vk.com/id${vkUser.id}`;

    return {
      providerAccountId,
      displayName,
      login,
      avatarUrl,
      profileUrl,
      accessToken,
      refreshToken,
      tokenExpiresAt,
      scopes,
    };
  },
};
