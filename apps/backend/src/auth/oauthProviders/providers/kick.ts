import { createOAuthState } from '../../oauthState.js';
import { exchangeKickCodeForToken, fetchKickUser, getKickAuthorizeUrl } from '../../providers/kick.js';
import { OAuthProviderError } from '../errors.js';
import type { OAuthProvider } from '../types.js';
import { asRecord } from '../utils.js';

function parseScopes(raw: string): string[] {
  return String(raw || '')
    .split(/[ ,+]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const kickOAuthProvider: OAuthProvider = {
  id: 'kick',
  supportsLogin: false,
  supportsLink: true,
  supportsBotLink: true,
  async buildAuthorizeUrl(params) {
    const clientId = process.env.KICK_CLIENT_ID;
    const callbackUrl = process.env.KICK_CALLBACK_URL;
    const authorizeUrl = process.env.KICK_AUTHORIZE_URL;
    const tokenUrl = process.env.KICK_TOKEN_URL;
    const refreshUrl = process.env.KICK_REFRESH_URL;
    const userInfoUrl = process.env.KICK_USERINFO_URL;
    const clientSecret = process.env.KICK_CLIENT_SECRET;
    if (!clientId || !callbackUrl || !authorizeUrl || !tokenUrl || !refreshUrl || !userInfoUrl || !clientSecret) {
      throw new OAuthProviderError('Kick OAuth not configured', {
        reason: 'missing_oauth_env',
        provider: 'kick',
        includeProviderParam: true,
      });
    }

    const { state } = await createOAuthState({
      provider: 'kick',
      kind: params.kind,
      userId: params.userId,
      channelId: params.channelId,
      redirectTo: params.redirectTo,
      origin: params.origin,
    });

    const scopes =
      params.kind === 'bot_link'
        ? parseScopes(String(process.env.KICK_BOT_SCOPES || process.env.KICK_SCOPES || ''))
        : parseScopes(String(process.env.KICK_SCOPES || ''));

    const authUrl = getKickAuthorizeUrl({
      authorizeUrl,
      clientId,
      redirectUri: callbackUrl,
      state,
      scopes,
    });

    return { authUrl };
  },
  async exchangeCode(params) {
    const clientId = process.env.KICK_CLIENT_ID;
    const clientSecret = process.env.KICK_CLIENT_SECRET;
    const callbackUrl = process.env.KICK_CALLBACK_URL;
    const tokenUrl = process.env.KICK_TOKEN_URL;
    const refreshUrl = process.env.KICK_REFRESH_URL;
    const userInfoUrl = process.env.KICK_USERINFO_URL;
    if (!clientId || !clientSecret || !callbackUrl || !tokenUrl || !refreshUrl || !userInfoUrl) {
      throw new OAuthProviderError('Kick OAuth not configured', {
        reason: 'missing_oauth_env',
        provider: 'kick',
        includeProviderParam: true,
      });
    }

    const tokenExchange = await exchangeKickCodeForToken({
      tokenUrl,
      clientId,
      clientSecret,
      code: params.code,
      redirectUri: callbackUrl,
    });
    if (!tokenExchange.data?.access_token) {
      throw new OAuthProviderError('No access token received from Kick', {
        reason: 'no_token',
        provider: 'kick',
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

    const userFetch = await fetchKickUser({ userInfoUrl, accessToken: String(tokenExchange.data.access_token) });
    const u = userFetch.user;
    const providerAccountId = String(u?.id ?? u?.user_id ?? '').trim();
    if (!providerAccountId) {
      throw new OAuthProviderError('No user data received from Kick', {
        reason: 'no_user',
        provider: 'kick',
        includeProviderParam: true,
      });
    }

    const uRec = asRecord(u);
    const displayName = String(uRec.display_name ?? uRec.name ?? '').trim() || null;
    const login = String(uRec.username ?? uRec.user_name ?? '').trim() || null;
    const avatarUrl = String(uRec.avatar_url ?? uRec.avatarUrl ?? '').trim() || null;
    const profileUrl = login ? `https://kick.com/${encodeURIComponent(login)}` : null;

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
