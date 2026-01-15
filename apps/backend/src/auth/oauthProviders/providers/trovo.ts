import { createOAuthState } from '../../oauthState.js';
import { exchangeTrovoCodeForToken, fetchTrovoUserInfo, getTrovoAuthorizeUrl } from '../../providers/trovo.js';
import { OAuthProviderError } from '../errors.js';
import type { OAuthProvider } from '../types.js';
import { asRecord } from '../utils.js';

function parseScopes(raw: string): string[] {
  return String(raw || '')
    .split(/[ ,+]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const trovoOAuthProvider: OAuthProvider = {
  id: 'trovo',
  supportsLogin: false,
  supportsLink: true,
  supportsBotLink: true,
  async buildAuthorizeUrl(params) {
    const clientId = process.env.TROVO_CLIENT_ID;
    const callbackUrl = process.env.TROVO_CALLBACK_URL;
    const clientSecret = process.env.TROVO_CLIENT_SECRET;
    if (!clientId || !callbackUrl || !clientSecret) {
      throw new OAuthProviderError('Trovo OAuth not configured', {
        reason: 'missing_oauth_env',
        provider: 'trovo',
        includeProviderParam: true,
      });
    }

    const { state } = await createOAuthState({
      provider: 'trovo',
      kind: params.kind,
      userId: params.userId,
      channelId: params.channelId,
      redirectTo: params.redirectTo,
      origin: params.origin,
    });

    const scopes =
      params.kind === 'bot_link'
        ? parseScopes(String(process.env.TROVO_BOT_SCOPES || process.env.TROVO_SCOPES || ''))
        : parseScopes(String(process.env.TROVO_SCOPES || ''));

    const authUrl = getTrovoAuthorizeUrl({
      clientId,
      redirectUri: callbackUrl,
      state,
      scopes,
    });

    return { authUrl };
  },
  async exchangeCode(params) {
    const clientId = process.env.TROVO_CLIENT_ID;
    const clientSecret = process.env.TROVO_CLIENT_SECRET;
    const callbackUrl = process.env.TROVO_CALLBACK_URL;
    if (!clientId || !clientSecret || !callbackUrl) {
      throw new OAuthProviderError('Trovo OAuth not configured', {
        reason: 'missing_oauth_env',
        provider: 'trovo',
        includeProviderParam: true,
      });
    }

    const tokenExchange = await exchangeTrovoCodeForToken({
      clientId,
      clientSecret,
      code: params.code,
      redirectUri: callbackUrl,
      tokenUrl: process.env.TROVO_TOKEN_URL || undefined,
    });

    if (!tokenExchange.data?.access_token) {
      throw new OAuthProviderError('No access token received from Trovo', {
        reason: 'no_token',
        provider: 'trovo',
        includeProviderParam: true,
      });
    }

    const accessToken = String(tokenExchange.data.access_token || '').trim() || null;
    const refreshToken = String(tokenExchange.data.refresh_token || '').trim() || null;
    const expiresIn = Number(tokenExchange.data.expires_in || 0);
    const tokenExpiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;
    const scopes = Array.isArray(tokenExchange.data.scope)
      ? tokenExchange.data.scope.join(' ')
      : tokenExchange.data.scope
        ? String(tokenExchange.data.scope)
        : null;

    const userInfo = await fetchTrovoUserInfo({
      clientId,
      accessToken: String(tokenExchange.data.access_token),
      userInfoUrl: process.env.TROVO_USERINFO_URL || undefined,
    });
    const trovoUser = userInfo.user;

    const tokenRec = asRecord(tokenExchange.data);
    const providerAccountId = String(trovoUser?.user_id ?? tokenRec.user_id ?? '').trim();
    if (!providerAccountId) {
      throw new OAuthProviderError('No user data received from Trovo', {
        reason: 'no_user',
        provider: 'trovo',
        includeProviderParam: true,
      });
    }

    const displayName = String(trovoUser?.nickname || '').trim() || null;
    const login = String(trovoUser?.user_name || '').trim() || null;
    const avatarUrl = String(trovoUser?.profile_pic || '').trim() || null;
    const profileUrl = login ? `https://trovo.live/${encodeURIComponent(login)}` : null;

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
