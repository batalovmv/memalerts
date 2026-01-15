import { createOAuthState } from '../../oauthState.js';
import {
  exchangeYouTubeCodeForToken,
  fetchGoogleTokenInfo,
  fetchYouTubeUser,
  getYouTubeAuthorizeUrl,
} from '../../providers/youtube.js';
import { logger } from '../../../utils/logger.js';
import { OAuthProviderError } from '../errors.js';
import type { OAuthProvider } from '../types.js';
import { decodeJwtPayloadNoVerify } from '../utils.js';

export const youtubeOAuthProvider: OAuthProvider = {
  id: 'youtube',
  supportsLogin: false,
  supportsLink: true,
  supportsBotLink: true,
  async buildAuthorizeUrl(params) {
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const callbackUrl = process.env.YOUTUBE_CALLBACK_URL;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    if (!clientId || !callbackUrl || !clientSecret) {
      throw new OAuthProviderError('YouTube OAuth not configured', {
        reason: 'missing_oauth_env',
        provider: 'youtube',
        includeProviderParam: true,
      });
    }

    const { state } = await createOAuthState({
      provider: 'youtube',
      kind: params.kind,
      userId: params.userId,
      channelId: params.channelId,
      redirectTo: params.redirectTo,
      origin: params.origin,
    });

    let scopes: string[];
    if (params.kind === 'bot_link') {
      scopes = ['https://www.googleapis.com/auth/youtube.force-ssl', 'openid', 'email', 'profile'];
    } else if (params.scopeHint === 'force_ssl') {
      scopes = ['https://www.googleapis.com/auth/youtube.force-ssl', 'openid'];
    } else {
      scopes = ['https://www.googleapis.com/auth/youtube.readonly', 'openid'];
    }

    const authUrl = getYouTubeAuthorizeUrl({
      clientId,
      redirectUri: callbackUrl,
      state,
      scopes,
      includeGrantedScopes: true,
    });

    return { authUrl };
  },
  async exchangeCode(params) {
    const tokenData = await exchangeYouTubeCodeForToken({
      clientId: process.env.YOUTUBE_CLIENT_ID!,
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET!,
      code: params.code,
      redirectUri: process.env.YOUTUBE_CALLBACK_URL!,
    });

    if (!tokenData.access_token) {
      throw new OAuthProviderError('No access token received from YouTube/Google', {
        reason: 'no_token',
        provider: 'youtube',
      });
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token || null;
    const tokenExpiresAt = tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null;
    let scopes = tokenData.scope || null;

    const tokenInfo = await fetchGoogleTokenInfo({ accessToken: tokenData.access_token });
    const idTokenSub = (() => {
      const idToken = String(tokenData?.id_token || '').trim();
      if (!idToken) return '';
      const payload = decodeJwtPayloadNoVerify(idToken);
      return String(payload?.sub || '').trim();
    })();
    const sub = String(tokenInfo?.sub || tokenInfo?.user_id || idTokenSub || '').trim();
    const tokenInfoScopes = tokenInfo?.scope ? String(tokenInfo.scope) : null;
    if (tokenInfoScopes) scopes = tokenInfoScopes;

    logger.info('oauth.youtube.callback.token_exchanged', {
      requestId: params.req.requestId,
      flow: params.stateKind || 'unknown',
      state: params.statePreview,
      state_userId: params.stateUserId || null,
      has_access_token: true,
      has_refresh_token: Boolean(refreshToken),
      token_scopes: scopes,
      tokeninfo_has_sub: Boolean(sub),
      tokeninfo_scopes: tokenInfoScopes,
      tokeninfo_error: tokenInfo?.error ?? null,
      tokeninfo_error_description: tokenInfo?.error_description ?? null,
    });

    if (!sub) {
      const googleUser = await fetchYouTubeUser({ accessToken: tokenData.access_token });
      if (!googleUser?.sub) {
        throw new OAuthProviderError('No user data received from YouTube/Google', {
          reason: 'no_user',
          provider: 'youtube',
        });
      }
      return {
        providerAccountId: googleUser.sub,
        displayName: googleUser.name || null,
        login: googleUser.email || null,
        avatarUrl: googleUser.picture || null,
        profileUrl: null,
        accessToken,
        refreshToken,
        tokenExpiresAt,
        scopes,
      };
    }

    return {
      providerAccountId: sub,
      displayName: null,
      login: null,
      avatarUrl: null,
      profileUrl: null,
      accessToken,
      refreshToken,
      tokenExpiresAt,
      scopes,
    };
  },
};
