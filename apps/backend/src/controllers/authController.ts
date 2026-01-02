import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { logAuthEvent } from '../utils/auditLogger.js';
import { debugLog, debugError } from '../utils/debug.js';
import { logger } from '../utils/logger.js';
import {
  fetchMyYouTubeChannelIdByAccessToken,
  fetchMyYouTubeChannelProfileByAccessToken,
  fetchYouTubeChannelProfilePublicByChannelId,
} from '../utils/youtubeApi.js';
import { createOAuthState, loadAndConsumeOAuthState } from '../auth/oauthState.js';
import { exchangeTwitchCodeForToken, fetchTwitchUser, getTwitchAuthorizeUrl } from '../auth/providers/twitch.js';
import { exchangeYouTubeCodeForToken, fetchGoogleTokenInfo, fetchYouTubeUser, getYouTubeAuthorizeUrl } from '../auth/providers/youtube.js';
import { exchangeVkCodeForToken, fetchVkUser, getVkAuthorizeUrl } from '../auth/providers/vk.js';
import { exchangeVkVideoCodeForToken, fetchVkVideoUser, generatePkceVerifier, getVkVideoAuthorizeUrl, pkceChallengeS256 } from '../auth/providers/vkvideo.js';
import { exchangeTrovoCodeForToken, fetchTrovoUserInfo, getTrovoAuthorizeUrl } from '../auth/providers/trovo.js';
import { exchangeKickCodeForToken, fetchKickUser, getKickAuthorizeUrl } from '../auth/providers/kick.js';
import { exchangeDiscordCodeForToken, fetchDiscordUser, getDiscordAuthorizeUrl } from '../auth/providers/discord.js';
import { fetchVkVideoCurrentUser } from '../utils/vkvideoApi.js';
import { BoostyApiClient } from '../utils/boostyApi.js';
import type { ExternalAccountProvider, OAuthStateKind } from '@prisma/client';
import { hasChannelEntitlement } from '../utils/entitlements.js';
import { ERROR_CODES } from '../shared/errors.js';
import { addDiscordGuildMember } from '../utils/discordApi.js';
import { claimPendingCoinGrantsTx } from '../rewards/pendingCoinGrants.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer } from '../realtime/walletBridge.js';
import type { Server } from 'socket.io';

// Helper function to get redirect URL based on environment and request
const getRedirectUrl = (req?: AuthRequest, stateOrigin?: string): string => {
  // First priority: use origin from state (set during OAuth initiation)
  if (stateOrigin) {
    return stateOrigin;
  }
  
  // Second priority: determine domain from Host header (for beta detection)
  if (req) {
    const host = req.get('host') || '';
    
    // If request came to beta domain, redirect to beta
    if (host.includes('beta.')) {
      const betaUrl = `https://${host.split(':')[0]}`;
      return betaUrl;
    }
  }
  
  // First, use WEB_URL if explicitly set (this is the primary way)
  if (process.env.WEB_URL) {
    return process.env.WEB_URL;
  }
  
  // Fallback: construct from DOMAIN if in production
  if (process.env.NODE_ENV === 'production' && process.env.DOMAIN) {
    const fallbackUrl = `https://${process.env.DOMAIN}`;
    return fallbackUrl;
  }
  
  // Development fallback
  const devUrl = 'http://localhost:5173';
  return devUrl;
};

const DEFAULT_LINK_REDIRECT = '/settings/accounts';

const REDIRECT_ALLOWLIST = new Set<string>(['/settings/accounts', '/settings/bot', '/settings/bot/youtube', '/dashboard', '/']);

function decodeJwtPayloadNoVerify(token: string): any | null {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const payload = parts[1]!;
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function sanitizeRedirectTo(input: unknown): string {
  const redirectTo = typeof input === 'string' ? input.trim() : '';
  if (!redirectTo) return DEFAULT_LINK_REDIRECT;

  // Only allow relative paths like "/settings/accounts".
  // Disallow protocol-relative URLs ("//evil.com") and absolute URLs ("https://...").
  if (!redirectTo.startsWith('/')) return DEFAULT_LINK_REDIRECT;
  if (redirectTo.startsWith('//')) return DEFAULT_LINK_REDIRECT;

  // Hard block common open-redirect patterns.
  if (redirectTo.includes('://')) return DEFAULT_LINK_REDIRECT;
  if (redirectTo.includes('\\')) return DEFAULT_LINK_REDIRECT;

  // Strict allowlist to prevent open redirects / unexpected navigation.
  if (!REDIRECT_ALLOWLIST.has(redirectTo)) return DEFAULT_LINK_REDIRECT;

  return redirectTo;
}

function buildRedirectWithError(baseUrl: string, redirectPath: string, params: Record<string, string | undefined>) {
  const url = new URL(`${baseUrl}${redirectPath}`);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }
  return url.toString();
}

function wantsJson(req: AuthRequest): boolean {
  const accept = String(req.get('accept') || '').toLowerCase();
  if (accept.includes('application/json')) return true;
  // Some clients send */* but still expect JSON for API calls; rely on XHR hint.
  const anyReq = req as any;
  if (anyReq?.xhr) return true;
  return false;
}

// Simple Twitch OAuth implementation (you can replace with passport-twitch-new)
export const authController = {
  initiateAuth: async (req: AuthRequest, res: Response) => {
    const provider = String((req.params as any)?.provider || '').trim().toLowerCase() as ExternalAccountProvider;
    if (provider !== 'twitch') {
      const redirectUrl = getRedirectUrl(req);
      return res.redirect(`${redirectUrl}/?error=auth_failed&reason=unsupported_provider`);
    }

    const clientId = process.env.TWITCH_CLIENT_ID;
    const callbackUrl = process.env.TWITCH_CALLBACK_URL;
    if (!clientId) {
      const redirectUrl = getRedirectUrl(req);
      return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_client_id`);
    }
    if (!callbackUrl) {
      const redirectUrl = getRedirectUrl(req);
      return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_callback_url`);
    }

    const redirectTo = (req.query.redirect_to as string) || null;

    // Best-effort origin detection (beta/prod isolation is handled via cookieName + domain logic later).
    const originHost = req.get('host') || '';
    const referer = req.get('referer') || '';
    const isBeta = originHost.includes('beta.') || referer.includes('beta.');

    let originUrl: string | null = null;
    if (isBeta) {
      if (originHost.includes('beta.')) {
        originUrl = `https://${originHost.split(':')[0]}`;
      } else if (referer) {
        try {
          const refererUrl = new URL(referer);
          originUrl = `${refererUrl.protocol}//${refererUrl.host}`;
        } catch {
          originUrl = null;
        }
      }
    }
    // If not beta, we can leave origin unset and fall back to getRedirectUrl() at callback time.

    const { state } = await createOAuthState({
      provider,
      kind: 'login',
      redirectTo,
      origin: originUrl,
    });

    const scopes = ['user:read:email', 'channel:read:redemptions', 'channel:manage:redemptions', 'chat:read', 'chat:edit'];
    const authUrl = getTwitchAuthorizeUrl({
      clientId,
      redirectUri: callbackUrl,
      state,
      scopes,
    });

    debugLog('auth.initiate', { provider, hasOrigin: !!originUrl, hasRedirectTo: !!redirectTo });
    return res.redirect(authUrl);
  },

  // Special YouTube link flow to request stronger scopes (force-ssl) for viewer-side activity rewards (e.g. videos.getRating).
  // This keeps the default /auth/youtube/link minimal (youtube.readonly) for streamers.
  initiateYouTubeForceSslLink: async (req: AuthRequest, res: Response) => {
    if (!req.userId) {
      const redirectUrl = getRedirectUrl(req);
      return res.redirect(`${redirectUrl}/?error=auth_required&reason=no_session`);
    }

    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const callbackUrl = process.env.YOUTUBE_CALLBACK_URL;
    if (!clientId || !callbackUrl || !process.env.YOUTUBE_CLIENT_SECRET) {
      const redirectUrl = getRedirectUrl(req);
      const redirectTo = sanitizeRedirectTo(req.query.redirect_to);
      return res.redirect(buildRedirectWithError(redirectUrl, redirectTo, { error: 'auth_failed', reason: 'missing_oauth_env', provider: 'youtube' }));
    }

    const redirectTo = sanitizeRedirectTo(req.query.redirect_to);
    const origin = (req.query.origin as string) || null;

    const { state } = await createOAuthState({
      provider: 'youtube',
      kind: 'link',
      userId: req.userId,
      redirectTo,
      origin,
    });

    // For viewer activity rewards we need user-scoped permissions for videos.getRating.
    // Include `openid` to reliably get a stable Google account id ("sub") in callback.
    const scopes = ['https://www.googleapis.com/auth/youtube.force-ssl', 'openid'];
    const authUrl = getYouTubeAuthorizeUrl({
      clientId,
      redirectUri: callbackUrl,
      state,
      scopes,
      includeGrantedScopes: true,
    });

    return res.redirect(authUrl);
  },

  initiateTwitchAuth: (req: AuthRequest, res: Response) => {
    // Backward-compatible alias for older frontend URLs: /auth/twitch
    (req.params as any).provider = 'twitch';
    return authController.initiateAuth(req, res);
  },

  handleCallback: async (req: AuthRequest, res: Response) => {
    // IMPORTANT: avoid `channel: true` in includes here.
    // If DB is temporarily behind migrations, selecting all Channel columns will throw (P2022).
    const safeChannelSelect = {
      id: true,
      slug: true,
      name: true,
      twitchChannelId: true,
      rewardIdForCoins: true,
      coinPerPointRatio: true,
      createdAt: true,
    } as const;

    const providerFromUrl = String((req.params as any)?.provider || '').trim().toLowerCase() as ExternalAccountProvider;

    const { code, error, state } = req.query;
    const errorDescription = (req.query as any)?.error_description;
    const requestId = (req as any)?.requestId as string | undefined;

    // Load+consume state from DB (real verification; old JSON-state is no longer supported).
    const stateId = typeof state === 'string' ? state : '';
    const consumed = await loadAndConsumeOAuthState(stateId);
    const stateOrigin = consumed.ok ? (consumed.row.origin || undefined) : undefined;
    const stateRedirectTo = consumed.ok ? (consumed.row.redirectTo || undefined) : undefined;
      const stateKind: OAuthStateKind | undefined = consumed.ok ? consumed.row.kind : undefined;
    const stateUserId: string | undefined = consumed.ok ? (consumed.row.userId || undefined) : undefined;
      const stateChannelId: string | undefined = consumed.ok ? ((consumed.row as any).channelId || undefined) : undefined;
    const stateCodeVerifier: string | undefined = consumed.ok ? ((consumed.row as any).codeVerifier || undefined) : undefined;
    const providerFromState: ExternalAccountProvider | undefined = consumed.ok ? consumed.row.provider : undefined;

    // Prefer provider from state, because URL provider may come from legacy aliases (e.g. vkplay).
    const provider: ExternalAccountProvider = providerFromState ?? providerFromUrl;

    const isVkVideo = provider === 'vkvideo';
    const codePreview = typeof code === 'string' ? code.slice(0, 8) : '';
    const statePreview = typeof stateId === 'string' ? stateId.slice(0, 12) : '';
    const stateFound = consumed.ok ? true : consumed.reason !== 'state_not_found';
    const verifierFound = consumed.ok ? !!stateCodeVerifier : !!(consumed as any)?.row?.codeVerifier;
    const errorDescPreview =
      typeof errorDescription === 'string' ? errorDescription.slice(0, 180) : undefined;

    if (isVkVideo) {
      logger.info('oauth.vkvideo.callback.received', {
        provider: 'vkvideo',
        state: statePreview,
        code: codePreview,
        error: typeof error === 'string' ? error : undefined,
        error_description: errorDescPreview,
        state_found: stateFound,
        verifier_found: verifierFound,
      });
    }

    debugLog('OAuth callback received', { provider, code: code ? 'present' : 'missing', error, stateOrigin });

    if (error) {
      console.error('OAuth error:', { provider, error, error_description: errorDescription });
      const redirectUrl = getRedirectUrl(req, stateOrigin);

      // VKVideo can return error + error_description instead of code (e.g. user denied consent).
      if (provider === 'vkvideo') {
        const details = typeof errorDescription === 'string' ? errorDescription.slice(0, 240) : String(error);
        logger.error('oauth.vkvideo.callback.oauth_error', {
          provider: 'vkvideo',
          error: typeof error === 'string' ? error : String(error),
          error_description: typeof errorDescription === 'string' ? errorDescription.slice(0, 240) : undefined,
        });
        return res.redirect(
          `${redirectUrl}/?error=auth_failed&reason=vk_oauth_error&provider=vkvideo&details=${encodeURIComponent(details)}`
        );
      }

      return res.redirect(`${redirectUrl}/?error=auth_failed&reason=${error}`);
    }

    if (!code) {
      console.error('No code in callback');
      const redirectUrl = getRedirectUrl(req, stateOrigin);
      return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_code`);
    }

    // Keep some context for catch() diagnostics.
    let diagProviderAccountId: string | null = null;
    let diagResolvedUserId: string | null = null;
    let diagExistingExternalUserId: string | null = null;

    try {
      if (!consumed.ok) {
        const redirectUrl = getRedirectUrl(req);
        return res.redirect(`${redirectUrl}/?error=auth_failed&reason=${consumed.reason}`);
      }

      // This callback handler serves login, link and bot_link flows.
      if (stateKind !== 'login' && stateKind !== 'link' && stateKind !== 'bot_link') {
        const redirectUrl = getRedirectUrl(req, stateOrigin);
        return res.redirect(`${redirectUrl}/?error=auth_failed&reason=invalid_state_kind`);
      }

      // We currently only support login via Twitch. Other providers are link-only/bot_link-only.
      if (stateKind === 'login' && provider !== 'twitch') {
        const redirectUrl = getRedirectUrl(req, stateOrigin);
        return res.redirect(`${redirectUrl}/?error=auth_failed&reason=login_not_supported&provider=${provider}`);
      }

      debugLog('Exchanging code for token...', { provider, stateKind });
      
      // Check if this is production backend handling beta callback
      // If callback came to production domain but state indicates beta origin,
      // we need to handle it specially
      const isProductionBackend = !process.env.DOMAIN?.includes('beta.') && process.env.PORT !== '3002';
      const isBetaCallback = stateOrigin && stateOrigin.includes('beta.');
      const requestHost = req.get('host') || '';
      const callbackCameToProduction = !requestHost.includes('beta.');
      
      // Provider-specific: exchange code -> token, fetch user profile.
      let providerAccountId: string;
      let displayName: string | null = null;
      let login: string | null = null;
      let avatarUrl: string | null = null;
      let profileUrl: string | null = null;
      let accessToken: string | null = null;
      let refreshToken: string | null = null;
      let tokenExpiresAt: Date | null = null;
      let scopes: string | null = null;

      if (provider === 'twitch') {
        const tokenData = await exchangeTwitchCodeForToken({
          clientId: process.env.TWITCH_CLIENT_ID!,
          clientSecret: process.env.TWITCH_CLIENT_SECRET!,
          code: code as string,
          redirectUri: process.env.TWITCH_CALLBACK_URL!,
        });
        debugLog('twitch.token.keys', { keys: Object.keys(tokenData || {}) });

        if (!tokenData.access_token) {
          console.error('No access token received from Twitch:', tokenData);
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_token`);
        }

        accessToken = tokenData.access_token;
        refreshToken = tokenData.refresh_token || null;
        tokenExpiresAt = tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null;
        scopes = Array.isArray(tokenData.scope) ? tokenData.scope.join(' ') : null;

        const twitchUser = await fetchTwitchUser({
          accessToken: tokenData.access_token,
          clientId: process.env.TWITCH_CLIENT_ID!,
        });
        if (!twitchUser) {
          console.error('No user data received from Twitch');
          await logAuthEvent('login_failed', null, false, req, 'No user data from Twitch');
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_user`);
        }

        providerAccountId = twitchUser.id;
        diagProviderAccountId = providerAccountId;
        displayName = twitchUser.display_name ?? null;
        login = twitchUser.login ?? null;
        avatarUrl = twitchUser.profile_image_url || null;
        profileUrl = twitchUser.login ? `https://www.twitch.tv/${twitchUser.login}` : null;
      } else if (provider === 'youtube') {
        const tokenData = await exchangeYouTubeCodeForToken({
          clientId: process.env.YOUTUBE_CLIENT_ID!,
          clientSecret: process.env.YOUTUBE_CLIENT_SECRET!,
          code: code as string,
          redirectUri: process.env.YOUTUBE_CALLBACK_URL!,
        });

        if (!tokenData.access_token) {
          console.error('No access token received from YouTube/Google:', tokenData);
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_token`);
        }

        accessToken = tokenData.access_token;
        refreshToken = tokenData.refresh_token || null;
        tokenExpiresAt = tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null;
        scopes = tokenData.scope || null;

        // IMPORTANT:
        // For streamer YouTube linking (readonly), we avoid OpenID/userinfo scopes to keep consent minimal.
        // For bot_link flows (force-ssl), we DO request OIDC scopes to reliably get a stable account id.
        //
        // Therefore, try to resolve the Google account id ("sub") via:
        // 1) tokeninfo (may include sub/user_id)
        // 2) id_token (JWT) if present (requires openid scope)
        // 3) userinfo endpoint as back-compat fallback (only works with openid scope)
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
          requestId: (req as any)?.requestId,
          flow: stateKind || 'unknown',
          state: statePreview,
          state_userId: stateUserId || null,
          has_access_token: true,
          has_refresh_token: Boolean(refreshToken),
          token_scopes: scopes,
          tokeninfo_has_sub: Boolean(sub),
          tokeninfo_scopes: tokenInfoScopes,
          tokeninfo_error: tokenInfo?.error ?? null,
          tokeninfo_error_description: tokenInfo?.error_description ?? null,
        });

        if (!sub) {
          // Back-compat fallback (works only if openid scope was requested).
          const googleUser = await fetchYouTubeUser({ accessToken: tokenData.access_token });
          if (!googleUser?.sub) {
            const redirectUrl = getRedirectUrl(req, stateOrigin);
            return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_user`);
          }
          providerAccountId = googleUser.sub;
          diagProviderAccountId = providerAccountId;
          displayName = googleUser.name || null;
          login = googleUser.email || null;
          avatarUrl = googleUser.picture || null;
          profileUrl = null;
        } else {
          providerAccountId = sub;
          diagProviderAccountId = providerAccountId;
          // We don't request profile/email scopes for streamer YouTube linking; keep these empty.
          // For bot_link with OIDC scopes, we could fill some fields, but it's optional.
          displayName = null;
          login = null;
          avatarUrl = null;
          profileUrl = null;
        }
      } else if (provider === 'vk') {
        const tokenData = await exchangeVkCodeForToken({
          clientId: process.env.VK_CLIENT_ID!,
          clientSecret: process.env.VK_CLIENT_SECRET!,
          code: code as string,
          redirectUri: process.env.VK_CALLBACK_URL!,
        });

        if (!tokenData.access_token || !tokenData.user_id) {
          console.error('No access token/user_id received from VK:', tokenData);
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_token`);
        }

        accessToken = tokenData.access_token;
        refreshToken = null;
        tokenExpiresAt = tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null;
        scopes = null;

        const vkUser = await fetchVkUser({ accessToken: tokenData.access_token, userId: tokenData.user_id });
        if (!vkUser) {
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_user`);
        }

        providerAccountId = String(vkUser.id);
        diagProviderAccountId = providerAccountId;
        const dn = [vkUser.first_name, vkUser.last_name].filter(Boolean).join(' ').trim();
        displayName = dn || null;
        login = vkUser.screen_name || tokenData.email || null;
        avatarUrl = vkUser.photo_200 || null;
        profileUrl = vkUser.screen_name ? `https://vk.com/${vkUser.screen_name}` : `https://vk.com/id${vkUser.id}`;
      } else if (provider === 'vkvideo') {
        const clientId = process.env.VKVIDEO_CLIENT_ID!;
        const callbackUrl = process.env.VKVIDEO_CALLBACK_URL!;
        const tokenUrl = process.env.VKVIDEO_TOKEN_URL!;
        const clientSecret = process.env.VKVIDEO_CLIENT_SECRET;
        if (!clientSecret) {
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          return res.redirect(`${redirectUrl}/?error=auth_failed&reason=missing_oauth_env`);
        }

        const tokenExchange = await exchangeVkVideoCodeForToken({
          tokenUrl,
          clientId,
          clientSecret,
          code: code as string,
          redirectUri: callbackUrl,
          codeVerifier: stateCodeVerifier || null,
        });

        if (isVkVideo) {
          logger.info('oauth.vkvideo.callback.token_exchange', {
            provider: 'vkvideo',
            status: tokenExchange.status,
            ok: tokenExchange.status >= 200 && tokenExchange.status < 300,
            has_access_token: !!tokenExchange.data?.access_token,
            error: tokenExchange.data?.error,
            error_description: tokenExchange.data?.error_description,
          });
          if (tokenExchange.status >= 400) {
            logger.error('oauth.vkvideo.callback.token_exchange_error', {
              provider: 'vkvideo',
              status: tokenExchange.status,
              body: tokenExchange.raw,
            });
          }
        }

        if (!tokenExchange.data.access_token) {
          console.error('No access token received from VKVideo:', tokenExchange.data);
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_token`);
        }

        accessToken = tokenExchange.data.access_token;
        refreshToken = tokenExchange.data.refresh_token || null;
        tokenExpiresAt = tokenExchange.data.expires_in ? new Date(Date.now() + tokenExchange.data.expires_in * 1000) : null;
        scopes = (Array.isArray(tokenExchange.data.scope) ? tokenExchange.data.scope.join(' ') : tokenExchange.data.scope) || null;

        const userInfoUrl = process.env.VKVIDEO_USERINFO_URL || null;
        const userFetch = await fetchVkVideoUser({ userInfoUrl, accessToken: tokenExchange.data.access_token });
        const vkVideoUser = userFetch.user;

        if (isVkVideo) {
          logger.info('oauth.vkvideo.callback.userinfo', {
            provider: 'vkvideo',
            status: userFetch.status,
            ok: userFetch.status === 0 ? null : userFetch.status >= 200 && userFetch.status < 300,
            has_user: !!vkVideoUser,
          });
          // If HTTP 200 but we couldn't map an id, log keys to adjust mapping (avoid logging tokens).
          if (userFetch.status >= 200 && userFetch.status < 300 && !vkVideoUser) {
            const raw = userFetch.raw;
            const topKeys = raw && typeof raw === 'object' ? Object.keys(raw).slice(0, 30) : null;
            const nestedKeys =
              raw && typeof raw === 'object'
                ? Object.keys((raw as any).user ?? (raw as any).data ?? (raw as any).response ?? (raw as any).result ?? {}).slice(0, 30)
                : null;
            logger.warn('oauth.vkvideo.callback.userinfo_unmapped', {
              provider: 'vkvideo',
              status: userFetch.status,
              top_keys: topKeys,
              nested_keys: nestedKeys,
            });
          }
          // If non-2xx, include response body best-effort (can help diagnose provider errors).
          if (userFetch.status >= 400) {
            logger.error('oauth.vkvideo.callback.userinfo_error', {
              provider: 'vkvideo',
              status: userFetch.status,
              body: userFetch.raw,
            });
          }
        }

        const tokenUserId = String(tokenExchange.data.sub ?? tokenExchange.data.user_id ?? '').trim();
        providerAccountId = String(vkVideoUser?.id || tokenUserId).trim();
        diagProviderAccountId = providerAccountId || null;

        // Fallback: if userinfo is not configured and token response does not include user id,
        // attempt to decode access_token as JWT and use its "sub" claim.
        if (!providerAccountId) {
          const jwtPayload = decodeJwtPayloadNoVerify(tokenExchange.data.access_token);
          const jwtSub = String(jwtPayload?.sub ?? '').trim();
          if (isVkVideo) {
            logger.info('oauth.vkvideo.callback.access_token_claims', {
              provider: 'vkvideo',
              has_jwt_payload: !!jwtPayload,
              jwt_sub_present: !!jwtSub,
              jwt_sub_preview: jwtSub ? jwtSub.slice(0, 24) : null,
              jwt_keys: jwtPayload && typeof jwtPayload === 'object' ? Object.keys(jwtPayload).slice(0, 12) : null,
            });
          }
          if (jwtSub) providerAccountId = jwtSub;
        }

        if (!providerAccountId) {
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_user`);
        }

        displayName = vkVideoUser?.displayName || null;
        login = vkVideoUser?.login || null;
        avatarUrl = vkVideoUser?.avatarUrl || null;
        profileUrl = vkVideoUser?.profileUrl || null;

        // Best-effort: enrich VKVideo identity via DevAPI current_user (fills channel slug/url).
        // This keeps /me cheap and ensures titles can be rendered without extra runtime fetches.
        try {
          const normalizeProfileUrl = (raw: string | null | undefined): { slug: string | null; url: string | null } => {
            const s = String(raw || '').trim();
            if (!s) return { slug: null, url: null };
            if (/^https?:\/\//i.test(s)) {
              try {
                const u = new URL(s);
                const parts = u.pathname.split('/').map((p) => p.trim()).filter(Boolean);
                const last = parts[parts.length - 1] || '';
                return { slug: last ? decodeURIComponent(last) : null, url: s };
              } catch {
                return { slug: null, url: s };
              }
            }
            const slug = s.replace(/^\/+/, '').replace(/^@/, '').trim();
            return { slug: slug || null, url: slug ? `https://live.vkvideo.ru/${slug}` : null };
          };

          const currentUser = await fetchVkVideoCurrentUser({ accessToken });
          if (currentUser.ok) {
            const root = (currentUser.data as any)?.data ?? (currentUser.data as any) ?? null;
            const u = (root as any)?.user ?? (root as any)?.profile ?? root ?? null;
            const channelUrlRaw =
              String((root as any)?.channel?.url || (u as any)?.channel?.url || (u as any)?.url || '').trim() || null;
            const normalized = normalizeProfileUrl(channelUrlRaw);

            if (!profileUrl && normalized.url) profileUrl = normalized.url;
            if (!login && normalized.slug) login = normalized.slug;

            const nameFromParts = String([u?.first_name, u?.last_name].filter(Boolean).join(' ')).trim() || null;
            const name =
              String(u?.display_name ?? u?.displayName ?? u?.name ?? u?.full_name ?? u?.nickname ?? u?.username ?? '').trim() ||
              nameFromParts ||
              null;
            if (!displayName && name) displayName = name;
          }
        } catch {
          // ignore
        }

        // Final fallback: for titles, prefer a stable non-null label.
        if (!displayName && login) displayName = login;
      } else if (provider === 'trovo') {
        const clientId = process.env.TROVO_CLIENT_ID;
        const clientSecret = process.env.TROVO_CLIENT_SECRET;
        const callbackUrl = process.env.TROVO_CALLBACK_URL;
        if (!clientId || !clientSecret || !callbackUrl) {
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          return res.redirect(`${redirectUrl}/?error=auth_failed&reason=missing_oauth_env&provider=trovo`);
        }

        const tokenExchange = await exchangeTrovoCodeForToken({
          clientId,
          clientSecret,
          code: code as string,
          redirectUri: callbackUrl,
          tokenUrl: process.env.TROVO_TOKEN_URL || undefined,
        });

        if (!tokenExchange.data?.access_token) {
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_token&provider=trovo`);
        }

        accessToken = String(tokenExchange.data.access_token || '').trim() || null;
        refreshToken = String(tokenExchange.data.refresh_token || '').trim() || null;
        const expiresIn = Number(tokenExchange.data.expires_in || 0);
        tokenExpiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;
        scopes = Array.isArray(tokenExchange.data.scope) ? tokenExchange.data.scope.join(' ') : (tokenExchange.data.scope ? String(tokenExchange.data.scope) : null);

        const userInfo = await fetchTrovoUserInfo({
          clientId,
          accessToken: String(tokenExchange.data.access_token),
          userInfoUrl: process.env.TROVO_USERINFO_URL || undefined,
        });
        const trovoUser = userInfo.user;

        providerAccountId = String(trovoUser?.user_id ?? (tokenExchange.data as any)?.user_id ?? '').trim();
        diagProviderAccountId = providerAccountId || null;
        if (!providerAccountId) {
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_user&provider=trovo`);
        }

        displayName = String(trovoUser?.nickname || '').trim() || null;
        login = String(trovoUser?.user_name || '').trim() || null;
        avatarUrl = String(trovoUser?.profile_pic || '').trim() || null;
        profileUrl = login ? `https://trovo.live/${encodeURIComponent(login)}` : null;
      } else if (provider === 'kick') {
        const clientId = process.env.KICK_CLIENT_ID;
        const clientSecret = process.env.KICK_CLIENT_SECRET;
        const callbackUrl = process.env.KICK_CALLBACK_URL;
        const tokenUrl = process.env.KICK_TOKEN_URL;
        const refreshUrl = process.env.KICK_REFRESH_URL;
        const userInfoUrl = process.env.KICK_USERINFO_URL;
        if (!clientId || !clientSecret || !callbackUrl || !tokenUrl || !refreshUrl || !userInfoUrl) {
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          return res.redirect(`${redirectUrl}/?error=auth_failed&reason=missing_oauth_env&provider=kick`);
        }

        const tokenExchange = await exchangeKickCodeForToken({
          tokenUrl,
          clientId,
          clientSecret,
          code: code as string,
          redirectUri: callbackUrl,
        });
        if (!tokenExchange.data?.access_token) {
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_token&provider=kick`);
        }

        accessToken = String(tokenExchange.data.access_token || '').trim() || null;
        refreshToken = String(tokenExchange.data.refresh_token || '').trim() || null;
        const expiresIn = Number(tokenExchange.data.expires_in || 0);
        tokenExpiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;
        scopes = Array.isArray(tokenExchange.data.scope)
          ? tokenExchange.data.scope.join(' ')
          : (tokenExchange.data.scope ? String(tokenExchange.data.scope) : null);

        const userFetch = await fetchKickUser({ userInfoUrl, accessToken: String(tokenExchange.data.access_token) });
        const u = userFetch.user;
        providerAccountId = String(u?.id ?? u?.user_id ?? '').trim();
        diagProviderAccountId = providerAccountId || null;
        if (!providerAccountId) {
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_user&provider=kick`);
        }

        displayName = String((u as any)?.display_name ?? (u as any)?.name ?? '').trim() || null;
        login = String((u as any)?.username ?? (u as any)?.user_name ?? '').trim() || null;
        avatarUrl = String((u as any)?.avatar_url ?? (u as any)?.avatarUrl ?? '').trim() || null;
        profileUrl = login ? `https://kick.com/${encodeURIComponent(login)}` : null;
      } else if (provider === 'discord') {
        const clientId = process.env.DISCORD_CLIENT_ID;
        const clientSecret = process.env.DISCORD_CLIENT_SECRET;
        const callbackUrl = process.env.DISCORD_CALLBACK_URL;
        if (!clientId || !clientSecret || !callbackUrl) {
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          return res.redirect(`${redirectUrl}/?error=auth_failed&reason=missing_oauth_env&provider=discord`);
        }

        const tokenExchange = await exchangeDiscordCodeForToken({
          clientId,
          clientSecret,
          code: code as string,
          redirectUri: callbackUrl,
          tokenUrl: process.env.DISCORD_TOKEN_URL || undefined,
        });

        if (!tokenExchange.data?.access_token) {
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_token&provider=discord`);
        }

        accessToken = String(tokenExchange.data.access_token || '').trim() || null;
        refreshToken = String(tokenExchange.data.refresh_token || '').trim() || null;
        const expiresIn = Number(tokenExchange.data.expires_in || 0);
        tokenExpiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;
        scopes = tokenExchange.data.scope ? String(tokenExchange.data.scope) : null;

        const userFetch = await fetchDiscordUser({
          accessToken: String(tokenExchange.data.access_token),
          userInfoUrl: process.env.DISCORD_USERINFO_URL || undefined,
        });

        const u = userFetch.user;
        providerAccountId = String(u?.id ?? '').trim();
        diagProviderAccountId = providerAccountId || null;
        if (!providerAccountId) {
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_user&provider=discord`);
        }

        const username = String(u?.username ?? '').trim() || null;
        const globalName = String((u as any)?.global_name ?? '').trim() || null;
        displayName = globalName || username || null;
        login = username;

        const avatar = String((u as any)?.avatar ?? '').trim() || null;
        avatarUrl = avatar ? `https://cdn.discordapp.com/avatars/${providerAccountId}/${avatar}.png?size=256` : null;
        profileUrl = `https://discord.com/users/${encodeURIComponent(providerAccountId)}`;

        // Optional: auto-join the platform guild so we can later read roles via bot token.
        // Requires: scope guilds.join + DISCORD_BOT_TOKEN + DISCORD_DEFAULT_SUBSCRIPTIONS_GUILD_ID (or legacy DISCORD_SUBSCRIPTIONS_GUILD_ID).
        const autoJoinEnabledRaw = String(process.env.DISCORD_AUTO_JOIN_GUILD || '').toLowerCase();
        const autoJoinEnabled = autoJoinEnabledRaw === '1' || autoJoinEnabledRaw === 'true' || autoJoinEnabledRaw === 'yes';
        const guildId =
          String(process.env.DISCORD_DEFAULT_SUBSCRIPTIONS_GUILD_ID || '').trim() ||
          String(process.env.DISCORD_SUBSCRIPTIONS_GUILD_ID || '').trim();
        const botToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();
        if (autoJoinEnabled && guildId && botToken && accessToken) {
          try {
            await addDiscordGuildMember({
              botToken,
              guildId,
              userId: providerAccountId,
              userAccessToken: accessToken,
            });
          } catch {
            // ignore best-effort
          }
        }
      } else {
        const redirectUrl = getRedirectUrl(req, stateOrigin);
        return res.redirect(`${redirectUrl}/?error=auth_failed&reason=provider_not_supported&provider=${provider}`);
      }

      // Map (provider, providerAccountId) -> ExternalAccount -> User
      const existingExternal = await prisma.externalAccount.findUnique({
        where: { provider_providerAccountId: { provider, providerAccountId } },
        select: { id: true, userId: true },
      });
      diagExistingExternalUserId = existingExternal?.userId ?? null;

      let user = null as any;

      if (stateKind === 'link' || stateKind === 'bot_link') {
        if (!stateUserId) {
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          return res.redirect(`${redirectUrl}/?error=auth_failed&reason=missing_link_user`);
        }
        if (existingExternal && existingExternal.userId !== stateUserId) {
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          const redirectPath = sanitizeRedirectTo(stateRedirectTo || DEFAULT_LINK_REDIRECT);
          // If the client expects JSON (API-style), return 409 with a stable errorCode.
          if (wantsJson(req)) {
            return res.status(409).json({
              errorCode: ERROR_CODES.ACCOUNT_ALREADY_LINKED,
              error: 'Account already linked',
              details: { provider, providerAccountId },
            });
          }
          return res.redirect(buildRedirectWithError(redirectUrl, redirectPath, { error: 'auth_failed', reason: 'account_already_linked', provider }));
        }

        user = await prisma.user.findUnique({
          where: { id: stateUserId },
          include: { wallets: true, channel: { select: safeChannelSelect } },
        });
        if (!user) {
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          return res.redirect(`${redirectUrl}/?error=auth_failed&reason=user_not_found`);
        }
      } else {
        // login (twitch only)
        if (provider !== 'twitch') {
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          return res.redirect(`${redirectUrl}/?error=auth_failed&reason=login_not_supported&provider=${provider}`);
        }

        // Canonical lookup: User.twitchUserId (unique). This avoids "reassigning" twitchUserId on a user
        // that was found via a different key (e.g. stale ExternalAccount mapping).
        const userByTwitchId = await prisma.user.findUnique({
          where: { twitchUserId: providerAccountId },
          include: { wallets: true, channel: { select: safeChannelSelect } },
        });

        if (userByTwitchId) {
          user = userByTwitchId;
          if (existingExternal && existingExternal.userId !== userByTwitchId.id) {
            logger.warn('oauth.twitch.login.mapping_mismatch', {
              requestId,
              state: statePreview,
              twitchUserId: providerAccountId,
              externalUserId: existingExternal.userId,
              userIdByTwitchUserId: userByTwitchId.id,
            });
          }
        }

        if (!user) {
          // If ExternalAccount exists but User.twitchUserId is not set anywhere, this Twitch account
          // is already linked as a secondary identity (e.g. bot_link) or DB is inconsistent.
          // Do NOT "steal" it for login by moving the ExternalAccount mapping.
          if (existingExternal) {
            logger.warn('oauth.twitch.login.account_already_linked_no_primary', {
              requestId,
              state: statePreview,
              twitchUserId: providerAccountId,
              externalUserId: existingExternal.userId,
            });

            const redirectUrl = getRedirectUrl(req, stateOrigin);
            const redirectPath = sanitizeRedirectTo(stateRedirectTo || '/');
            if (wantsJson(req)) {
              return res.status(409).json({
                errorCode: ERROR_CODES.ACCOUNT_ALREADY_LINKED,
                error: 'Account already linked',
                details: { provider, providerAccountId },
              });
            }
            return res.redirect(
              buildRedirectWithError(redirectUrl, redirectPath, {
                error: 'auth_failed',
                reason: 'account_already_linked',
                provider,
              })
            );
          }

          // First login: create viewer user (no Channel auto-creation)
          user = await prisma.user.create({
            data: {
              twitchUserId: providerAccountId,
              displayName: displayName || 'Twitch User',
              profileImageUrl: avatarUrl || null,
              role: 'viewer',
              channelId: null,
              twitchAccessToken: accessToken,
              twitchRefreshToken: refreshToken,
            },
            include: { wallets: true, channel: { select: safeChannelSelect } },
          });
        }
      }
      diagResolvedUserId = user?.id ?? null;

      // Upsert ExternalAccount (either login or link). For Twitch login, also refresh legacy User fields.
      const botLinkChannelId = stateKind === 'bot_link' ? String(stateChannelId || '').trim() : '';
      const isBotLinkProvider =
        stateKind === 'bot_link' && (provider === 'youtube' || provider === 'vkvideo' || provider === 'twitch' || provider === 'trovo' || provider === 'kick');

      let botLinkSubscriptionDenied = false;
      let botLinkSubscriptionDeniedProvider: string | null = null;
      let allowPerChannelBotOverride = true;
      const claimedWalletEvents: any[] = [];

      if (isBotLinkProvider && botLinkChannelId) {
        const isGlobalSentinel =
          (provider === 'youtube' && botLinkChannelId === '__global_youtube_bot__') ||
          (provider === 'vkvideo' && botLinkChannelId === '__global_vkvideo_bot__') ||
          (provider === 'twitch' && botLinkChannelId === '__global_twitch_bot__') ||
          (provider === 'trovo' && botLinkChannelId === '__global_trovo_bot__') ||
          (provider === 'kick' && botLinkChannelId === '__global_kick_bot__');

        if (!isGlobalSentinel) {
          allowPerChannelBotOverride = await hasChannelEntitlement(botLinkChannelId, 'custom_bot');
          if (!allowPerChannelBotOverride) {
            botLinkSubscriptionDenied = true;
            botLinkSubscriptionDeniedProvider = provider;
            logger.info('entitlement.denied', {
              channelId: botLinkChannelId,
              provider,
              action: 'bot_link_apply',
              requestId: (req as any)?.requestId || null,
            });
          }
        }
      }

      await prisma.$transaction(async (tx) => {
        // IMPORTANT (Google/YouTube):
        // Google часто НЕ возвращает refresh_token при повторном consent, даже если access_type=offline.
        // Нельзя затирать уже сохранённый refreshToken значением null, иначе последующие API-вызовы (channels.list mine=true)
        // перестанут работать после истечения access token.
        const externalUpdate: any = {
          userId: user.id,
          accessToken,
          tokenExpiresAt,
          scopes,
          // Avoid overwriting previously saved profile fields with nulls on subsequent re-link flows.
          ...(displayName ? { displayName } : {}),
          ...(login ? { login } : {}),
          ...(avatarUrl ? { avatarUrl } : {}),
          ...(profileUrl ? { profileUrl } : {}),
        };
        if (refreshToken) externalUpdate.refreshToken = refreshToken;

        const upserted = await tx.externalAccount.upsert({
          where: { provider_providerAccountId: { provider, providerAccountId } },
          create: {
            userId: user.id,
            provider,
            providerAccountId,
            displayName,
            login,
            avatarUrl,
            profileUrl,
            accessToken,
            refreshToken,
            tokenExpiresAt,
            scopes,
          },
          update: externalUpdate,
          select: { id: true },
        });

        // Best-effort: for YouTube accounts, store the YouTube channelId in `login`
        // so we can later resolve chat authors by `authorChannelId` (YouTube chat does not expose Google "sub").
        // This is safe for streamer linking because we don't use email login for YouTube anyway.
        if (provider === 'youtube' && accessToken) {
          try {
            const profile = await fetchMyYouTubeChannelProfileByAccessToken(accessToken);
            const channelId = profile?.channelId || (await fetchMyYouTubeChannelIdByAccessToken(accessToken));
            if (channelId) {
              const data: any = {
                login: channelId,
                profileUrl: `https://www.youtube.com/channel/${channelId}`,
              };
              // For readonly linking we intentionally avoid OIDC profile scopes; use channel snippet instead.
              if (profile?.title) data.displayName = profile.title;
              if (profile?.avatarUrl) data.avatarUrl = profile.avatarUrl;
              if (!data.displayName || !data.avatarUrl) {
                const publicProfile = await fetchYouTubeChannelProfilePublicByChannelId(channelId);
                if (!data.displayName && publicProfile?.title) data.displayName = publicProfile.title;
                if (!data.avatarUrl && publicProfile?.avatarUrl) data.avatarUrl = publicProfile.avatarUrl;
              }

              await tx.externalAccount.update({ where: { id: upserted.id }, data });
            }
          } catch {
            // ignore
          }
        }

        // IMPORTANT:
        // Only the Twitch *login* flow should update legacy User.twitch* fields.
        // For link/bot_link (e.g. linking a separate bot account), updating User.twitchUserId can violate
        // the unique constraint and also corrupt the "logged-in user" identity.
        if (provider === 'twitch' && stateKind === 'login') {
          if (user.twitchUserId && user.twitchUserId !== providerAccountId) {
            // Safety net: should be prevented by the selection logic above.
            logger.error('oauth.twitch.login.user_mismatch_guard', {
              requestId,
              state: statePreview,
              twitchUserId: providerAccountId,
              userId: user.id,
              userTwitchUserId: user.twitchUserId,
            });
            throw new Error('twitch_user_mismatch');
          }

          await tx.user.update({
            where: { id: user.id },
            data: {
              twitchUserId: providerAccountId,
              displayName: displayName || user.displayName,
              profileImageUrl: avatarUrl || null,
              twitchAccessToken: accessToken,
              twitchRefreshToken: refreshToken,
            },
          });
        }

        // Bot linking: map this external account as the channel's bot sender.
        // Supported providers: youtube, vkvideo, twitch, trovo, kick.
        if ((provider === 'youtube' || provider === 'vkvideo' || provider === 'twitch' || provider === 'trovo' || provider === 'kick') && stateKind === 'bot_link') {
          const channelId = String(stateChannelId || '').trim();
          if (!channelId) {
            throw new Error('missing_bot_link_channel');
          }

          if (provider === 'youtube') {
            // Special sentinel channelId: store the default/global YouTube bot credential.
            if (channelId === '__global_youtube_bot__') {
              await (tx as any).globalYouTubeBotCredential.deleteMany({});
              await (tx as any).globalYouTubeBotCredential.create({
                data: { externalAccountId: upserted.id, enabled: true },
                select: { id: true },
              });
            } else {
              // Default behavior: per-channel override (stored as mapping to this channel).
              if (allowPerChannelBotOverride) {
                await (tx as any).youTubeBotIntegration.upsert({
                  where: { channelId },
                  create: { channelId, externalAccountId: upserted.id, enabled: true },
                  update: { externalAccountId: upserted.id, enabled: true },
                  select: { id: true },
                });
              }
            }
          }

          if (provider === 'vkvideo') {
            // Special sentinel channelId: store the default/global VKVideo bot credential.
            if (channelId === '__global_vkvideo_bot__') {
              await (tx as any).globalVkVideoBotCredential.deleteMany({});
              await (tx as any).globalVkVideoBotCredential.create({
                data: { externalAccountId: upserted.id, enabled: true },
                select: { id: true },
              });
            } else {
              // Default behavior: per-channel override.
              if (allowPerChannelBotOverride) {
                await (tx as any).vkVideoBotIntegration.upsert({
                  where: { channelId },
                  create: { channelId, externalAccountId: upserted.id, enabled: true },
                  update: { externalAccountId: upserted.id, enabled: true },
                  select: { id: true },
                });
              }
            }
          }

          if (provider === 'twitch') {
            // Special sentinel channelId: store the default/global Twitch bot credential.
            if (channelId === '__global_twitch_bot__') {
              await (tx as any).globalTwitchBotCredential.deleteMany({});
              await (tx as any).globalTwitchBotCredential.create({
                data: { externalAccountId: upserted.id, enabled: true },
                select: { id: true },
              });
            } else {
              // Default behavior: per-channel override.
              if (allowPerChannelBotOverride) {
                await (tx as any).twitchBotIntegration.upsert({
                  where: { channelId },
                  create: { channelId, externalAccountId: upserted.id, enabled: true },
                  update: { externalAccountId: upserted.id, enabled: true },
                  select: { id: true },
                });
              }
            }
          }

          if (provider === 'trovo') {
            // Special sentinel channelId: store the default/global Trovo bot credential.
            if (channelId === '__global_trovo_bot__') {
              await (tx as any).globalTrovoBotCredential.deleteMany({});
              await (tx as any).globalTrovoBotCredential.create({
                data: { externalAccountId: upserted.id, enabled: true },
                select: { id: true },
              });
            } else {
              // Default behavior: per-channel override.
              if (allowPerChannelBotOverride) {
                await (tx as any).trovoBotIntegration.upsert({
                  where: { channelId },
                  create: { channelId, externalAccountId: upserted.id, enabled: true },
                  update: { externalAccountId: upserted.id, enabled: true },
                  select: { id: true },
                });
              }
            }
          }

          if (provider === 'kick') {
            // Special sentinel channelId: store the default/global Kick bot credential.
            if (channelId === '__global_kick_bot__') {
              await (tx as any).globalKickBotCredential.deleteMany({});
              await (tx as any).globalKickBotCredential.create({
                data: { externalAccountId: upserted.id, enabled: true },
                select: { id: true },
              });
            } else {
              // Default behavior: per-channel override.
              if (allowPerChannelBotOverride) {
                await (tx as any).kickBotIntegration.upsert({
                  where: { channelId },
                  create: { channelId, externalAccountId: upserted.id, enabled: true },
                  update: { externalAccountId: upserted.id, enabled: true },
                  select: { id: true },
                });
              }
            }
          }
        }

        // Claim pending coin grants for this external identity (viewer linking flow).
        // IMPORTANT: do NOT claim on bot_link to avoid granting coins for a bot account identity.
        if (stateKind !== 'bot_link' && (provider === 'kick' || provider === 'trovo' || provider === 'vkvideo' || provider === 'twitch')) {
          try {
            const events = await claimPendingCoinGrantsTx({
              tx: tx as any,
              userId: user.id,
              provider,
              providerAccountId,
            });
            if (events.length) claimedWalletEvents.push(...events);
          } catch (e: any) {
            // Non-fatal: linking must succeed even if claim fails.
            logger.warn('external_rewards.claim_failed', { provider, errorMessage: e?.message || String(e) });
          }
        }
      });

      // Reload user to reflect updated fields
      user = await prisma.user.findUnique({
        where: { id: user.id },
        include: { wallets: true, channel: { select: safeChannelSelect } },
      });

      // Ensure user exists
      if (!user) {
        console.error('User is null after creation/fetch');
        const redirectUrl = getRedirectUrl(req, stateOrigin);
        return res.redirect(`${redirectUrl}/?error=auth_failed&reason=user_null`);
      }

      // Emit wallet updates (if any) AFTER transaction commit.
      if (claimedWalletEvents.length > 0) {
        try {
          const io: Server = req.app.get('io');
          for (const ev of claimedWalletEvents) {
            emitWalletUpdated(io, ev);
            void relayWalletUpdatedToPeer(ev);
          }
        } catch (e: any) {
          logger.warn('external_rewards.wallet_emit_failed', { errorMessage: e?.message || String(e) });
        }
      }

      // Determine redirect URL first (needed for cookie domain and beta access check)
      const redirectUrl = getRedirectUrl(req, stateOrigin);
      
      // Check both stateOrigin and redirectUrl for beta detection
      const isBetaRedirect = (stateOrigin && stateOrigin.includes('beta.')) || (redirectUrl && redirectUrl.includes('beta.'));
      
      // Beta access is gated by explicit admin approval (hasBetaAccess).
      // Do NOT auto-grant access on login. This ensures revoked users cannot regain access by re-logging in.
      const isBetaBackend = process.env.DOMAIN?.includes('beta.') || process.env.PORT === '3002';
      const isBetaLogin = isBetaRedirect || (stateOrigin && stateOrigin.includes('beta.'));
      
      debugLog('[BETA_ACCESS_DEBUG] Checking conditions', {
        isBetaBackend,
        isBetaLogin,
        hasBetaAccess: user.hasBetaAccess,
        domain: process.env.DOMAIN,
        port: process.env.PORT,
        stateOrigin,
        redirectUrl,
      });
      
      // Keep debug logs to understand beta login context, but never mutate hasBetaAccess here.
      debugLog('[BETA_ACCESS_DEBUG] Beta login context (no auto-grant)', {
        isBetaBackend,
        isBetaLogin,
        hasBetaAccess: user.hasBetaAccess,
        domain: process.env.DOMAIN,
        port: process.env.PORT,
        stateOrigin,
        redirectUrl,
      });

      debugLog('User created/found, generating JWT...');
      
      // If production backend received callback for beta, create temporary token and redirect to beta
      if (isProductionBackend && isBetaCallback && callbackCameToProduction) {
        // Create a short-lived token for beta backend to use
        const tempToken = jwt.sign(
          {
            userId: user.id,
            role: user.role,
            channelId: user.channelId,
            tempForBeta: true,
          },
          process.env.JWT_SECRET!,
          { expiresIn: '5m' } as SignOptions // Short-lived token
        );
        
        // Redirect to beta backend with temporary token
        // Beta backend will exchange this for a proper cookie
        const betaAuthUrl = `${stateOrigin}/auth/twitch/complete?token=${encodeURIComponent(tempToken)}&state=${encodeURIComponent(state as string)}`;
        debugLog('Redirecting to beta backend for cookie setup:', betaAuthUrl);
        return res.redirect(betaAuthUrl);
      }
      
      // Generate JWT
      const token = jwt.sign(
        {
          userId: user.id,
          role: user.role,
          channelId: user.channelId,
        },
        process.env.JWT_SECRET!,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as SignOptions
      );

      // Set httpOnly cookie
      // Use secure in production (HTTPS) and lax sameSite for OAuth redirects
      const isProduction = process.env.NODE_ENV === 'production';
      
      // If production backend received callback for beta, we need to handle it after token exchange
      // We'll create a temporary token and redirect to beta backend
      // (isProductionBackend, isBetaCallback, callbackCameToProduction are already declared above)
      if (isProductionBackend && isBetaCallback && callbackCameToProduction) {
        debugLog('Production backend received beta callback, will redirect to beta backend after token exchange');
      }
      
      // Determine cookie domain based on redirect URL
      // IMPORTANT: For security, beta and production cookies must be isolated
      // - For beta: use exact domain (beta.twitchmemes.ru) without dot prefix to isolate from production
      // - For production: don't set domain explicitly - browser will set it to current domain only
      // redirectUrl and isBetaRedirect are already declared above (before beta access check)
      let cookieDomain: string | undefined;
      
      if (isBetaRedirect) {
        // For beta, use the exact beta domain (without dot prefix) to isolate from production
        // This ensures cookies are NOT shared between beta and production
        try {
          const urlToParse = redirectUrl || stateOrigin;
          if (urlToParse) {
            const url = new URL(urlToParse);
            const hostname = url.hostname;
            // Use exact hostname for beta (e.g., beta.twitchmemes.ru) without dot prefix
            // This prevents cookie from working on production domain
            cookieDomain = hostname;
          }
        } catch (e) {
          // If parsing fails, don't set domain - browser will handle it
        }
      }
      // For production, don't set domain - browser will automatically set it to the current domain only
      
      const cookieOptions: any = {
        httpOnly: true,
        secure: isProduction, // Only send over HTTPS in production
        sameSite: 'lax', // Changed from 'strict' to allow OAuth redirects
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/', // Ensure cookie is available for all paths
      };

      // Set domain only if we determined it should be set for beta
      if (cookieDomain) {
        cookieOptions.domain = cookieDomain;
      }
      // Otherwise, don't set domain explicitly - let browser handle it
      debugLog('Setting cookie with options:', {
        httpOnly: cookieOptions.httpOnly,
        secure: cookieOptions.secure,
        sameSite: cookieOptions.sameSite,
        path: cookieOptions.path,
        domain: cookieOptions.domain,
        maxAge: cookieOptions.maxAge,
        isProduction,
        stateOrigin,
        cookieDomain,
        'cookieDomain set': !!cookieDomain,
      });

      // Set cookie
      // Use dedicated cookie name for beta to avoid cross-subdomain collisions with production.
      const cookieName = isBetaRedirect ? 'token_beta' : 'token';
      res.cookie(cookieName, token, cookieOptions);
      
      // Verify cookie was set in response
      const setCookieHeader = res.getHeader('Set-Cookie');
      debugLog('Set-Cookie header:', setCookieHeader);
      debugLog('Response headers before redirect:', Object.keys(res.getHeaders()));
      
      if (!setCookieHeader) {
        console.error('WARNING: Set-Cookie header is not set!');
      }

      // Redirect logic: prioritize redirectTo from state (user came from a specific page)
      // redirectUrl was already determined above for cookie domain
      let redirectPath = '/';
      
      // First priority: Check if state parameter contains a redirect path (user came from a specific page)
      if (stateRedirectTo) {
        // Use redirect path from state - this preserves where user was before login/link
        redirectPath = sanitizeRedirectTo(stateRedirectTo);
        debugLog('Using redirectTo from state:', redirectPath);
      } else if (stateKind === 'link') {
        // Link flow default: return to accounts settings
        redirectPath = DEFAULT_LINK_REDIRECT;
      } else if (stateKind === 'login' && user.role === 'streamer' && user.channel?.slug) {
        // Second priority: If user is streamer with channel, redirect to dashboard
        // (but only if no redirectTo was specified)
        redirectPath = '/dashboard';
        debugLog('Redirecting streamer to dashboard (no redirectTo in state)');
      } else {
        // Default: redirect to home
        redirectPath = '/';
        debugLog('Redirecting to home (default)');
      }
      
      // Build final redirect URL
      // If redirectPath is different from default, add it as query parameter for frontend
      let finalRedirectUrl = `${redirectUrl}${redirectPath}`;
      
      // If we're using a redirectTo from state (user came from specific page), 
      // pass it in URL so frontend can use it
      if (stateRedirectTo && stateRedirectTo !== redirectPath) {
        // redirectPath already contains stateRedirectTo, so just use it
        finalRedirectUrl = `${redirectUrl}${redirectPath}`;
      }

      // If bot_link override was denied by entitlement, surface it to frontend via query params.
      if (botLinkSubscriptionDenied) {
        try {
          const u = new URL(finalRedirectUrl);
          u.searchParams.set('error', 'auth_failed');
          u.searchParams.set('reason', 'subscription_required');
          u.searchParams.set('provider', botLinkSubscriptionDeniedProvider || provider);
          finalRedirectUrl = u.toString();
        } catch {
          // ignore URL parsing errors
        }
      }
      
      debugLog('Auth successful, redirecting to:', {
        finalRedirectUrl,
        redirectPath,
        stateRedirectTo,
      });

      if (isVkVideo) {
        logger.info('oauth.vkvideo.callback.final_redirect', {
          provider: 'vkvideo',
          final_redirect: redirectPath,
          base: redirectUrl,
          state_redirect: stateRedirectTo ? sanitizeRedirectTo(stateRedirectTo) : null,
          state_kind: stateKind,
        });
      }
      
      // Use 302 redirect (temporary) to ensure cookie is sent
      res.status(302).redirect(finalRedirectUrl);
    } catch (error) {
      // Prefer structured logs (requestId + state) so we can correlate with client reports.
      logger.error('oauth.callback.exception', {
        requestId,
        provider: providerFromUrl,
        state: statePreview,
        flow: stateKind || 'unknown',
        state_userId: stateUserId || null,
        providerAccountId: diagProviderAccountId,
        existingExternalUserId: diagExistingExternalUserId,
        resolvedUserId: diagResolvedUserId,
        errorMessage: error instanceof Error ? error.message : String(error),
        ...(process.env.NODE_ENV === 'production' ? {} : { stack: error instanceof Error ? error.stack : undefined }),
      });

      console.error('Auth error:', error);
      debugError('Auth error (debug)', error);
      if (providerFromUrl === 'vkvideo') {
        logger.error('oauth.vkvideo.callback.exception', {
          provider: 'vkvideo',
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
      if (error instanceof Error) {
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        // Log Prisma errors in detail
        if (error.message.includes('P2002') || error.message.includes('Unique constraint')) {
          console.error('Database unique constraint violation - user or channel may already exist');
        }
        if (error.message.includes('P2003') || error.message.includes('Foreign key constraint')) {
          console.error('Database foreign key constraint violation');
        }
      }
      // Log error as JSON for better debugging
      console.error('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
      
      // Extract stateOrigin from state if available
      let stateOrigin: string | undefined;
      if (req.query.state && typeof req.query.state === 'string') {
        try {
          const row = await prisma.oAuthState.findUnique({ where: { state: req.query.state } });
          stateOrigin = row?.origin || undefined;
        } catch {
          // ignore
        }
      }
      
      const redirectUrl = getRedirectUrl(req, stateOrigin);
      const errorReason = error instanceof Error ? encodeURIComponent(error.message.substring(0, 100)) : 'unknown';
      res.redirect(`${redirectUrl}/?error=auth_failed&reason=exception&details=${errorReason}`);
    }
  },

  handleTwitchCallback: (req: AuthRequest, res: Response) => {
    // Backward-compatible alias for older frontend URLs: /auth/twitch/callback
    (req.params as any).provider = 'twitch';
    return authController.handleCallback(req, res);
  },

  initiateLink: async (req: AuthRequest, res: Response) => {
    const provider = String((req.params as any)?.provider || '').trim().toLowerCase() as ExternalAccountProvider;
    if (!req.userId) {
      const redirectUrl = getRedirectUrl(req);
      // Prefer redirect to frontend so user can continue login flow.
      return res.redirect(`${redirectUrl}/?error=auth_required&reason=no_session`);
    }

    const rawRedirectTo = req.query.redirect_to;
    const redirectTo = sanitizeRedirectTo(rawRedirectTo);
    const origin = (req.query.origin as string) || null;

    // Provider-specific env validation + authorize url.
    let authUrl: string | null = null;
    if (provider === 'twitch') {
      const clientId = process.env.TWITCH_CLIENT_ID;
      const callbackUrl = process.env.TWITCH_CALLBACK_URL;
      if (!clientId || !callbackUrl) {
        const redirectUrl = getRedirectUrl(req);
        return res.redirect(buildRedirectWithError(redirectUrl, redirectTo, { error: 'auth_failed', reason: 'missing_oauth_env', provider }));
      }

      const { state } = await createOAuthState({
        provider,
        kind: 'link',
        userId: req.userId,
        redirectTo,
        origin,
      });

      const scopes = ['user:read:email', 'channel:read:redemptions', 'channel:manage:redemptions', 'chat:read', 'chat:edit'];
      authUrl = getTwitchAuthorizeUrl({
        clientId,
        redirectUri: callbackUrl,
        state,
        scopes,
      });
    } else if (provider === 'youtube') {
      const clientId = process.env.YOUTUBE_CLIENT_ID;
      const callbackUrl = process.env.YOUTUBE_CALLBACK_URL;
      if (!clientId || !callbackUrl || !process.env.YOUTUBE_CLIENT_SECRET) {
        const redirectUrl = getRedirectUrl(req);
        return res.redirect(buildRedirectWithError(redirectUrl, redirectTo, { error: 'auth_failed', reason: 'missing_oauth_env', provider }));
      }

      const { state } = await createOAuthState({
        provider,
        kind: 'link',
        userId: req.userId,
        redirectTo,
        origin,
      });

      // YouTube linking is used to identify the streamer's YouTube channel and read live chat / live status.
      //
      // Minimal-permissions policy:
      // - Streamers should NOT have to grant "scary" write scopes.
      // - Sending chat messages is done by a shared MemAlerts bot account (server-side token).
      //
      // Therefore for user linking we request ONLY read scope:
      //
      // IMPORTANT: we also include `openid` to reliably get a stable Google account id ("sub")
      // in the callback (via id_token/tokeninfo). Without it, Google may omit `sub`, causing
      // the callback to fail with reason=no_user even though consent succeeded.
      const scopes = ['https://www.googleapis.com/auth/youtube.readonly', 'openid'];
      authUrl = getYouTubeAuthorizeUrl({
        clientId,
        redirectUri: callbackUrl,
        state,
        scopes,
        includeGrantedScopes: true,
      });
    } else if (provider === 'vk' || provider === 'vkplay') {
      // NOTE: front expects provider "vk". We still accept "vkplay" for backward compatibility.
      const effectiveProvider: ExternalAccountProvider = provider === 'vkplay' ? ('vk' as ExternalAccountProvider) : provider;
      const clientId = process.env.VK_CLIENT_ID;
      const callbackUrl = process.env.VK_CALLBACK_URL;
      if (!clientId || !callbackUrl || !process.env.VK_CLIENT_SECRET) {
        const redirectUrl = getRedirectUrl(req);
        return res.redirect(buildRedirectWithError(redirectUrl, redirectTo, { error: 'auth_failed', reason: 'missing_oauth_env', provider: effectiveProvider }));
      }

      const { state } = await createOAuthState({
        provider: effectiveProvider,
        kind: 'link',
        userId: req.userId,
        redirectTo,
        origin,
      });

      authUrl = getVkAuthorizeUrl({
        clientId,
        redirectUri: callbackUrl,
        state,
        scopes: [],
      });
    } else if (provider === 'vkvideo') {
      const clientId = process.env.VKVIDEO_CLIENT_ID;
      const callbackUrl = process.env.VKVIDEO_CALLBACK_URL;
      const authorizeUrl = process.env.VKVIDEO_AUTHORIZE_URL;
      const tokenUrl = process.env.VKVIDEO_TOKEN_URL;
      if (!clientId || !callbackUrl || !authorizeUrl || !tokenUrl) {
        const redirectUrl = getRedirectUrl(req);
        return res.redirect(buildRedirectWithError(redirectUrl, redirectTo, { error: 'auth_failed', reason: 'missing_oauth_env', provider }));
      }

      const codeVerifier = generatePkceVerifier();
      const codeChallenge = pkceChallengeS256(codeVerifier);

      const { state, expiresAt } = await createOAuthState({
        provider,
        kind: 'link',
        userId: req.userId,
        redirectTo,
        origin,
        codeVerifier,
      });

      const ttlMs = Math.max(0, expiresAt.getTime() - Date.now());
      const verifierHash = crypto.createHash('sha256').update(codeVerifier).digest('hex').slice(0, 12);
      logger.info('oauth.vkvideo.link.start', {
        provider: 'vkvideo',
        userId: req.userId,
        flow: 'link',
        redirect_to: redirectTo,
        state: state.slice(0, 12),
        state_ttl_ms: ttlMs,
        state_storage: 'db:OAuthState',
        code_challenge_method: 'S256',
        code_verifier_saved: true,
        code_verifier_hash: verifierHash,
      });

      const scopes = String(process.env.VKVIDEO_SCOPES || '')
        .split(/[ ,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      authUrl = getVkVideoAuthorizeUrl({
        authorizeUrl,
        clientId,
        redirectUri: callbackUrl,
        state,
        scopes,
        codeChallenge,
      });
    } else if (provider === 'trovo') {
      const clientId = process.env.TROVO_CLIENT_ID;
      const callbackUrl = process.env.TROVO_CALLBACK_URL;
      const clientSecret = process.env.TROVO_CLIENT_SECRET;
      if (!clientId || !callbackUrl || !clientSecret) {
        const redirectUrl = getRedirectUrl(req);
        return res.redirect(
          buildRedirectWithError(redirectUrl, redirectTo, { error: 'auth_failed', reason: 'missing_oauth_env', provider })
        );
      }

      const { state } = await createOAuthState({
        provider,
        kind: 'link',
        userId: req.userId,
        redirectTo,
        origin,
      });

      const scopes = String(process.env.TROVO_SCOPES || '')
        .split(/[ ,+]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      authUrl = getTrovoAuthorizeUrl({
        clientId,
        redirectUri: callbackUrl,
        state,
        scopes,
      });
    } else if (provider === 'kick') {
      const clientId = process.env.KICK_CLIENT_ID;
      const callbackUrl = process.env.KICK_CALLBACK_URL;
      const authorizeUrl = process.env.KICK_AUTHORIZE_URL;
      const tokenUrl = process.env.KICK_TOKEN_URL;
      const refreshUrl = process.env.KICK_REFRESH_URL;
      const userInfoUrl = process.env.KICK_USERINFO_URL;
      const clientSecret = process.env.KICK_CLIENT_SECRET;
      if (!clientId || !callbackUrl || !authorizeUrl || !tokenUrl || !refreshUrl || !userInfoUrl || !clientSecret) {
        const redirectUrl = getRedirectUrl(req);
        return res.redirect(
          buildRedirectWithError(redirectUrl, redirectTo, { error: 'auth_failed', reason: 'missing_oauth_env', provider })
        );
      }

      const { state } = await createOAuthState({
        provider,
        kind: 'link',
        userId: req.userId,
        redirectTo,
        origin,
      });

      const scopes = String(process.env.KICK_SCOPES || '')
        .split(/[ ,+]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      authUrl = getKickAuthorizeUrl({
        authorizeUrl,
        clientId,
        redirectUri: callbackUrl,
        state,
        scopes,
      });
    } else if (provider === 'discord') {
      const clientId = process.env.DISCORD_CLIENT_ID;
      const callbackUrl = process.env.DISCORD_CALLBACK_URL;
      const clientSecret = process.env.DISCORD_CLIENT_SECRET;
      if (!clientId || !callbackUrl || !clientSecret) {
        const redirectUrl = getRedirectUrl(req);
        return res.redirect(buildRedirectWithError(redirectUrl, redirectTo, { error: 'auth_failed', reason: 'missing_oauth_env', provider }));
      }

      const { state } = await createOAuthState({
        provider,
        kind: 'link',
        userId: req.userId,
        redirectTo,
        origin,
      });

      const scopes = String(process.env.DISCORD_JOIN_SCOPES || '')
        .split(/[ ,+]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!scopes.includes('identify')) scopes.unshift('identify');
      const autoJoinEnabledRaw = String(process.env.DISCORD_AUTO_JOIN_GUILD || '').toLowerCase();
      const autoJoinEnabled = autoJoinEnabledRaw === '1' || autoJoinEnabledRaw === 'true' || autoJoinEnabledRaw === 'yes';
      // Only request guilds.join when we actually plan to auto-add to the guild.
      const defaultGuildId =
        String(process.env.DISCORD_DEFAULT_SUBSCRIPTIONS_GUILD_ID || '').trim() ||
        String(process.env.DISCORD_SUBSCRIPTIONS_GUILD_ID || '').trim();
      if (autoJoinEnabled && defaultGuildId && process.env.DISCORD_BOT_TOKEN) {
        if (!scopes.includes('guilds.join')) scopes.push('guilds.join');
      }

      authUrl = getDiscordAuthorizeUrl({
        clientId,
        redirectUri: callbackUrl,
        state,
        scopes,
      });
    } else if (provider === 'boosty') {
      // Boosty has no supported OAuth redirect flow in our backend.
      // Linking is done via POST /auth/boosty/link (manual token + optional blog name).
      const redirectUrl = getRedirectUrl(req, origin || undefined);
      const url = new URL(`${redirectUrl}${redirectTo}`);
      url.searchParams.set('provider', 'boosty');
      url.searchParams.set('mode', 'manual');
      return res.redirect(url.toString());
    } else {
      // Providers without implemented OAuth yet: boosty.
      const redirectUrl = getRedirectUrl(req);
      return res.redirect(buildRedirectWithError(redirectUrl, redirectTo, { error: 'auth_failed', reason: 'provider_not_supported', provider }));
    }

    return res.redirect(authUrl!);
  },

  handleLinkCallback: async (req: AuthRequest, res: Response) => {
    // Same handler: the state.kind determines whether this becomes login or link.
    return authController.handleCallback(req, res);
  },

  linkBoosty: async (req: AuthRequest, res: Response) => {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const mode = String(process.env.BOOSTY_REWARDS_MODE || 'boosty_api').trim().toLowerCase();
    if (mode === 'discord_roles') {
      return res.status(410).json({
        error: 'Gone',
        errorCode: 'BOOSTY_LINK_DEPRECATED',
        message: 'Boosty token linking is no longer supported. Please link Discord instead.',
      });
    }

    const body = (req.body || {}) as any;
    // UI-friendly alias: accept { token } as well as { accessToken } (existing contract).
    const accessTokenRaw = typeof body.accessToken === 'string' ? body.accessToken : typeof body.token === 'string' ? body.token : '';
    // Tokens are commonly pasted with trailing newlines/spaces; strip all whitespace.
    const accessToken = accessTokenRaw ? String(accessTokenRaw).replace(/\s+/g, '') : '';
    const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken.trim() : '';
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
    const blogName = typeof body.blogName === 'string' ? body.blogName.trim() : '';

    if (!accessToken && !(refreshToken && deviceId)) {
      return res.status(400).json({
        error: 'Bad Request',
        errorCode: 'BOOSTY_LINK_MISSING_CREDENTIALS',
        message: 'Provide accessToken OR (refreshToken + deviceId)',
      });
    }

    // Validate Boosty token immediately to keep UX snappy and avoid storing garbage credentials.
    // Also attempt to resolve a stable Boosty user id (best-effort) for providerAccountId.
    let stableBoostyUserId: string | null = null;
    if (accessToken) {
      const baseUrl = String(process.env.BOOSTY_API_BASE_URL || 'https://api.boosty.to').trim();
      const client = new BoostyApiClient({ baseUrl, auth: { accessToken } });
      try {
        // Any successful response implies token is accepted; empty subscriptions is OK.
        await client.getUserSubscriptions({ limit: 1, withFollow: false });
        stableBoostyUserId = await client.getMyUserIdBestEffort();
      } catch (e: any) {
        const status = Number(e?.status || 0);
        if (status === 401 || status === 403) {
          return res.status(401).json({
            error: 'Unauthorized',
            errorCode: 'BOOSTY_INVALID_TOKEN',
            message: 'Boosty token is invalid or expired',
          });
        }
        if (status === 429) {
          return res.status(429).json({
            error: 'Too Many Requests',
            errorCode: 'BOOSTY_RATE_LIMITED',
            message: 'Too many attempts. Please wait and try again',
          });
        }
        return res.status(503).json({
          error: 'Service Unavailable',
          errorCode: 'BOOSTY_UNAVAILABLE',
          message: 'Boosty is unavailable. Please try again later',
        });
      }
    }

    // Prefer stable account id when we can resolve it from Boosty "whoami" (best-effort).
    let stableIdFromWhoami: string | null = null;
    if (stableBoostyUserId) stableIdFromWhoami = stableBoostyUserId;

    // Otherwise, prefer stable account id when we can derive it from a JWT token payload.
    let stableIdFromJwt: string | null = null;
    if (accessToken) {
      const payload = decodeJwtPayloadNoVerify(accessToken);
      const candidate =
        String(payload?.user_id ?? payload?.userId ?? payload?.uid ?? payload?.sub ?? payload?.id ?? '').trim();
      if (candidate) stableIdFromJwt = candidate;
    }

    const stableId = stableIdFromWhoami ?? stableIdFromJwt;

    const providerAccountId = stableId
      ? BoostyApiClient.stableProviderAccountId(`boosty:${stableId}`)
      : crypto
          .createHash('sha256')
          .update(refreshToken && deviceId ? `${refreshToken}:${deviceId}` : accessToken)
          .digest('hex')
          .slice(0, 48);

    // For most users we want a single Boosty account link. Update if exists, otherwise create.
    const existing = await (prisma as any).externalAccount.findFirst({
      where: {
        userId: req.userId,
        provider: 'boosty',
        // Ensure this endpoint cannot touch bot credentials (none exist for boosty today, but keep consistent).
        youTubeBotIntegration: { is: null },
        globalYouTubeBotCredential: { is: null },
        vkVideoBotIntegration: { is: null },
        globalVkVideoBotCredential: { is: null },
        twitchBotIntegration: { is: null },
        globalTwitchBotCredential: { is: null },
        trovoBotIntegration: { is: null },
        globalTrovoBotCredential: { is: null },
        kickBotIntegration: { is: null },
        globalKickBotCredential: { is: null },
      },
      select: { id: true, providerAccountId: true },
    });

    // Prevent overwriting a different user's account if providerAccountId collides (shared unique index).
    const collision = await (prisma as any).externalAccount.findUnique({
      where: { provider_providerAccountId: { provider: 'boosty', providerAccountId } },
      select: { id: true, userId: true },
    });
    if (collision && collision.userId !== req.userId) {
      return res.status(409).json({
        error: 'Conflict',
        errorCode: 'BOOSTY_ACCOUNT_ALREADY_LINKED',
        message: 'This Boosty credentials are already linked to a different user',
      });
    }

    const targetId = existing?.id || collision?.id || null;
    const account = targetId
      ? await (prisma as any).externalAccount.update({
          where: { id: targetId },
          data: {
            accessToken: accessToken || null,
            refreshToken: refreshToken || null,
            deviceId: deviceId || null,
            login: blogName || undefined,
            profileUrl: blogName ? `https://boosty.to/${encodeURIComponent(blogName)}` : undefined,
          },
          select: {
            id: true,
            provider: true,
            providerAccountId: true,
            displayName: true,
            login: true,
            avatarUrl: true,
            profileUrl: true,
            createdAt: true,
            updatedAt: true,
          },
        })
      : await (prisma as any).externalAccount.create({
          data: {
            userId: req.userId,
            provider: 'boosty',
            providerAccountId,
            accessToken: accessToken || null,
            refreshToken: refreshToken || null,
            deviceId: deviceId || null,
            // Best-effort: store blogName in login for UI purposes (no stable user id is available).
            login: blogName || null,
            profileUrl: blogName ? `https://boosty.to/${encodeURIComponent(blogName)}` : null,
          },
          select: {
            id: true,
            provider: true,
            providerAccountId: true,
            displayName: true,
            login: true,
            avatarUrl: true,
            profileUrl: true,
            createdAt: true,
            updatedAt: true,
          },
        });

    // If a streamer links Boosty and provides blogName, store it on their channel too (so rewards can target this blog).
    const isStreamer = String(req.userRole || '').toLowerCase() === 'streamer' || String(req.userRole || '').toLowerCase() === 'admin';
    if (isStreamer && req.channelId && blogName) {
      try {
        await prisma.channel.update({
          where: { id: req.channelId },
          data: { boostyBlogName: blogName },
          select: { id: true },
        });
      } catch {
        // ignore best-effort
      }
    }

    return res.json({ ok: true, account });
  },

  listAccounts: async (req: AuthRequest, res: Response) => {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    // IMPORTANT: /auth/accounts is "user-linked identities" (minimal scopes).
    // Bot credentials (global default bot and per-channel bot sender overrides) must NOT appear here.
    const accounts = await (prisma as any).externalAccount.findMany({
      where: {
        userId: req.userId,
        youTubeBotIntegration: { is: null },
        globalYouTubeBotCredential: { is: null },
        vkVideoBotIntegration: { is: null },
        globalVkVideoBotCredential: { is: null },
        twitchBotIntegration: { is: null },
        globalTwitchBotCredential: { is: null },
        trovoBotIntegration: { is: null },
        globalTrovoBotCredential: { is: null },
        kickBotIntegration: { is: null },
        globalKickBotCredential: { is: null },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        provider: true,
        providerAccountId: true,
        displayName: true,
        login: true,
        avatarUrl: true,
        profileUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({ accounts });
  },

  unlinkAccount: async (req: AuthRequest, res: Response) => {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
    const externalAccountId = String((req.params as any)?.externalAccountId || '').trim();
    if (!externalAccountId) return res.status(400).json({ error: 'Bad Request' });

    // Prevent unlinking bot credentials via the "user accounts" endpoint.
    const row = await (prisma as any).externalAccount.findFirst({
      where: { id: externalAccountId, userId: req.userId },
      select: {
        id: true,
        provider: true,
        youTubeBotIntegration: { select: { id: true } },
        globalYouTubeBotCredential: { select: { id: true } },
        vkVideoBotIntegration: { select: { id: true } },
        globalVkVideoBotCredential: { select: { id: true } },
        twitchBotIntegration: { select: { id: true } },
        globalTwitchBotCredential: { select: { id: true } },
        trovoBotIntegration: { select: { id: true } },
        globalTrovoBotCredential: { select: { id: true } },
        kickBotIntegration: { select: { id: true } },
        globalKickBotCredential: { select: { id: true } },
      },
    });

    if (!row) return res.status(404).json({ error: 'Not found' });

    const isBotCredential =
      Boolean((row as any).youTubeBotIntegration?.id) ||
      Boolean((row as any).globalYouTubeBotCredential?.id) ||
      Boolean((row as any).vkVideoBotIntegration?.id) ||
      Boolean((row as any).globalVkVideoBotCredential?.id) ||
      Boolean((row as any).twitchBotIntegration?.id) ||
      Boolean((row as any).globalTwitchBotCredential?.id) ||
      Boolean((row as any).trovoBotIntegration?.id) ||
      Boolean((row as any).globalTrovoBotCredential?.id) ||
      Boolean((row as any).kickBotIntegration?.id) ||
      Boolean((row as any).globalKickBotCredential?.id);

    if (isBotCredential) {
      const provider = String((row as any).provider || '').toLowerCase();
      const hintByProvider: Record<string, string> = {
        youtube: 'Use DELETE /owner/bots/youtube/default (global) or DELETE /streamer/bots/youtube/bot (per-channel override).',
        twitch: 'Use DELETE /owner/bots/twitch/default (global) or DELETE /streamer/bots/twitch/bot (per-channel override).',
        vkvideo: 'Use DELETE /owner/bots/vkvideo/default (global) or DELETE /streamer/bots/vkvideo/bot (per-channel override).',
        trovo: 'Use DELETE /owner/bots/trovo/default (global) or DELETE /streamer/bots/trovo/bot (per-channel override).',
        kick: 'Use DELETE /owner/bots/kick/default (global) or DELETE /streamer/bots/kick/bot (per-channel override).',
      };

      const isGlobal =
        Boolean((row as any).globalYouTubeBotCredential?.id) ||
        Boolean((row as any).globalVkVideoBotCredential?.id) ||
        Boolean((row as any).globalTwitchBotCredential?.id) ||
        Boolean((row as any).globalTrovoBotCredential?.id) ||
        Boolean((row as any).globalKickBotCredential?.id);
      const kind = isGlobal ? 'global_bot_credential' : 'channel_bot_credential';
      const unlinkEndpoint =
        provider === 'youtube'
          ? (isGlobal ? 'DELETE /owner/bots/youtube/default' : 'DELETE /streamer/bots/youtube/bot')
          : provider === 'twitch'
            ? (isGlobal ? 'DELETE /owner/bots/twitch/default' : 'DELETE /streamer/bots/twitch/bot')
            : provider === 'vkvideo'
              ? (isGlobal ? 'DELETE /owner/bots/vkvideo/default' : 'DELETE /streamer/bots/vkvideo/bot')
              : provider === 'trovo'
                ? (isGlobal ? 'DELETE /owner/bots/trovo/default' : 'DELETE /streamer/bots/trovo/bot')
                  : provider === 'kick'
                    ? (isGlobal ? 'DELETE /owner/bots/kick/default' : 'DELETE /streamer/bots/kick/bot')
              : null;
      return res.status(409).json({
        errorCode: 'CONFLICT',
        error: 'This account is used as a bot credential and cannot be unlinked via /auth/accounts',
        details: {
          kind,
          provider,
          unlinkEndpoint,
          hint: hintByProvider[provider] ?? null,
        },
      });
    }

    const count = await (prisma as any).externalAccount.count({
      where: {
        userId: req.userId,
        youTubeBotIntegration: { is: null },
        globalYouTubeBotCredential: { is: null },
        vkVideoBotIntegration: { is: null },
        globalVkVideoBotCredential: { is: null },
        twitchBotIntegration: { is: null },
        globalTwitchBotCredential: { is: null },
        trovoBotIntegration: { is: null },
        globalTrovoBotCredential: { is: null },
        kickBotIntegration: { is: null },
        globalKickBotCredential: { is: null },
      },
    });
    if (count <= 1) {
      return res.status(400).json({ error: 'Cannot unlink last account' });
    }

    const deleted = await prisma.externalAccount.deleteMany({
      where: { id: externalAccountId, userId: req.userId },
    });
    if (deleted.count === 0) return res.status(404).json({ error: 'Not found' });

    return res.json({ ok: true });
  },

  logout: async (req: AuthRequest, res: Response) => {
    const cookieOptions: any = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    };

    // Clear BOTH prod and beta cookies to prevent "stuck" sessions when domains overlap.
    // We clear:
    // - token (prod cookie name)
    // - token_beta (beta cookie name)
    // With several domain variants to reliably remove old cookies that might have been set with Domain=twitchmemes.ru.
    const host = (req.get('host') || '').split(':')[0];
    const baseDomain = process.env.DOMAIN || 'twitchmemes.ru';
    const domainVariants = Array.from(new Set<string | undefined>([
      undefined,
      host || undefined,
      baseDomain || undefined,
      baseDomain ? `beta.${baseDomain.replace(/^beta\./, '')}` : undefined,
      baseDomain ? baseDomain.replace(/^beta\./, '') : undefined,
    ]));

    for (const domain of domainVariants) {
      const opts = domain ? { ...cookieOptions, domain } : cookieOptions;
      res.clearCookie('token', opts);
      res.clearCookie('token_beta', opts);
    }
    
    // Log logout
    if (req.userId) {
      await logAuthEvent('logout', req.userId, true, req);
    }
    
    res.json({ message: 'Logged out successfully' });
  },

  completeBetaAuth: async (req: AuthRequest, res: Response) => {
    // This endpoint is called by beta backend when production backend redirects with temp token
    const { token, state } = req.query;

    if (!token || typeof token !== 'string') {
      return res.redirect('/?error=auth_failed&reason=no_token');
    }

    try {
      // Verify the temporary token
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
        userId: string;
        role: string;
        channelId?: string;
        tempForBeta?: boolean;
      };

      if (!decoded.tempForBeta) {
        return res.redirect('/?error=auth_failed&reason=invalid_token');
      }

      // NOTE: Do NOT auto-grant beta access on login.
      // Beta access must be explicitly approved by an admin.

      // Extract redirect path from state if present
      let redirectPath = '/';
      let stateOrigin: string | undefined;
      if (state && typeof state === 'string') {
        try {
          const row = await prisma.oAuthState.findUnique({ where: { state } });
          if (row?.origin) stateOrigin = row.origin;
          if (row?.redirectTo) redirectPath = row.redirectTo;
        } catch {
          // ignore
        }
      }

      // Generate proper JWT token for beta
      const betaToken = jwt.sign(
        {
          userId: decoded.userId,
          role: decoded.role,
          channelId: decoded.channelId,
        },
        process.env.JWT_SECRET!,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as SignOptions
      );

      // Set cookie for beta domain
      const isProduction = process.env.NODE_ENV === 'production';
      const redirectUrl = getRedirectUrl(req, stateOrigin);
      
      // Determine cookie domain for beta
      let cookieDomain: string | undefined;
      if (redirectUrl && redirectUrl.includes('beta.')) {
        try {
          const url = new URL(redirectUrl);
          cookieDomain = url.hostname;
        } catch (e) {
          // Ignore
        }
      }

      const cookieOptions: any = {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/',
      };

      if (cookieDomain) {
        cookieOptions.domain = cookieDomain;
      }

      // Use dedicated cookie name for beta to avoid cross-subdomain collisions with production.
      res.cookie('token_beta', betaToken, cookieOptions);

      // Redirect to appropriate page
      const finalRedirectUrl = `${redirectUrl}${redirectPath}`;
      debugLog('Beta auth completed, redirecting to:', finalRedirectUrl);
      res.redirect(finalRedirectUrl);
    } catch (error) {
      console.error('Error completing beta auth:', error);
      res.redirect('/?error=auth_failed&reason=token_verification_failed');
    }
  },
};

