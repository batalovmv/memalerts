import { createOAuthState } from '../../oauthState.js';
import { exchangeTwitchCodeForToken, fetchTwitchUser, getTwitchAuthorizeUrl } from '../../providers/twitch.js';
import { logAuthEvent } from '../../../utils/auditLogger.js';
import { debugLog } from '../../../utils/debug.js';
import { OAuthProviderError } from '../errors.js';
import type { OAuthProvider } from '../types.js';

const LOGIN_SCOPES = [
  'user:read:email',
  'channel:read:redemptions',
  'channel:manage:redemptions',
  'chat:read',
  'chat:edit',
];

const BOT_SCOPES = ['chat:read', 'chat:edit'];

function buildCallbackUrl(origin?: string | null): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    url.pathname = '/auth/twitch/callback';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export const twitchOAuthProvider: OAuthProvider = {
  id: 'twitch',
  supportsLogin: true,
  supportsLink: true,
  supportsBotLink: true,
  async buildAuthorizeUrl(params) {
    const clientId = process.env.TWITCH_CLIENT_ID;
    const callbackUrl = buildCallbackUrl(params.origin) ?? process.env.TWITCH_CALLBACK_URL;
    if (params.kind === 'login') {
      if (!clientId) {
        throw new OAuthProviderError('Missing TWITCH_CLIENT_ID', { reason: 'no_client_id', provider: 'twitch' });
      }
      if (!callbackUrl) {
        throw new OAuthProviderError('Missing TWITCH_CALLBACK_URL', { reason: 'no_callback_url', provider: 'twitch' });
      }
    } else if (!clientId || !callbackUrl) {
      throw new OAuthProviderError('Twitch OAuth not configured', {
        reason: 'missing_oauth_env',
        provider: 'twitch',
        includeProviderParam: true,
      });
    }

    const { state } = await createOAuthState({
      provider: 'twitch',
      kind: params.kind,
      userId: params.userId,
      channelId: params.channelId,
      redirectTo: params.redirectTo,
      origin: params.origin,
    });

    const scopes = params.kind === 'bot_link' ? BOT_SCOPES : LOGIN_SCOPES;
    const authUrl = getTwitchAuthorizeUrl({
      clientId: clientId!,
      redirectUri: callbackUrl!,
      state,
      scopes,
    });

    return { authUrl };
  },
  async exchangeCode(params) {
    const callbackUrl = buildCallbackUrl(params.stateOrigin) ?? process.env.TWITCH_CALLBACK_URL;
    if (!callbackUrl) {
      throw new OAuthProviderError('Missing TWITCH_CALLBACK_URL', { reason: 'no_callback_url', provider: 'twitch' });
    }
    const tokenData = await exchangeTwitchCodeForToken({
      clientId: process.env.TWITCH_CLIENT_ID!,
      clientSecret: process.env.TWITCH_CLIENT_SECRET!,
      code: params.code,
      redirectUri: callbackUrl,
    });
    debugLog('twitch.token.keys', { keys: Object.keys(tokenData || {}) });

    if (!tokenData.access_token) {
      throw new OAuthProviderError('No access token received from Twitch', { reason: 'no_token', provider: 'twitch' });
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token || null;
    const tokenExpiresAt = tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null;
    const scopes = Array.isArray(tokenData.scope) ? tokenData.scope.join(' ') : null;

    const twitchUser = await fetchTwitchUser({
      accessToken: tokenData.access_token,
      clientId: process.env.TWITCH_CLIENT_ID!,
    });
    if (!twitchUser) {
      await logAuthEvent('login_failed', null, false, params.req, 'No user data from Twitch');
      throw new OAuthProviderError('No user data received from Twitch', { reason: 'no_user', provider: 'twitch' });
    }

    const providerAccountId = twitchUser.id;
    const displayName = twitchUser.display_name ?? null;
    const login = twitchUser.login ?? null;
    const avatarUrl = twitchUser.profile_image_url || null;
    const profileUrl = twitchUser.login ? `https://www.twitch.tv/${twitchUser.login}` : null;

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
