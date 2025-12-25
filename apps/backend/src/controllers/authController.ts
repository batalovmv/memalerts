import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { logAuthEvent } from '../utils/auditLogger.js';
import { debugLog, debugError } from '../utils/debug.js';
import { logger } from '../utils/logger.js';
import { createOAuthState, loadAndConsumeOAuthState } from '../auth/oauthState.js';
import { exchangeTwitchCodeForToken, fetchTwitchUser, getTwitchAuthorizeUrl } from '../auth/providers/twitch.js';
import { exchangeYouTubeCodeForToken, fetchGoogleTokenInfo, fetchYouTubeUser, getYouTubeAuthorizeUrl } from '../auth/providers/youtube.js';
import { exchangeVkCodeForToken, fetchVkUser, getVkAuthorizeUrl } from '../auth/providers/vk.js';
import { exchangeVkVideoCodeForToken, fetchVkVideoUser, generatePkceVerifier, getVkVideoAuthorizeUrl, pkceChallengeS256 } from '../auth/providers/vkvideo.js';
import type { ExternalAccountProvider, OAuthStateKind } from '@prisma/client';

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
          displayName = googleUser.name || null;
          login = googleUser.email || null;
          avatarUrl = googleUser.picture || null;
          profileUrl = null;
        } else {
          providerAccountId = sub;
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
      } else {
        const redirectUrl = getRedirectUrl(req, stateOrigin);
        return res.redirect(`${redirectUrl}/?error=auth_failed&reason=provider_not_supported&provider=${provider}`);
      }

      // Map (provider, providerAccountId) -> ExternalAccount -> User
      const existingExternal = await prisma.externalAccount.findUnique({
        where: { provider_providerAccountId: { provider, providerAccountId } },
        select: { id: true, userId: true },
      });

      let user = null as any;

      if (stateKind === 'link' || stateKind === 'bot_link') {
        if (!stateUserId) {
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          return res.redirect(`${redirectUrl}/?error=auth_failed&reason=missing_link_user`);
        }
        if (existingExternal && existingExternal.userId !== stateUserId) {
          const redirectUrl = getRedirectUrl(req, stateOrigin);
          const redirectPath = sanitizeRedirectTo(stateRedirectTo || DEFAULT_LINK_REDIRECT);
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

        if (existingExternal) {
          user = await prisma.user.findUnique({
            where: { id: existingExternal.userId },
            include: { wallets: true, channel: { select: safeChannelSelect } },
          });
        }

        // Legacy fallback (pre-backfill)
        if (!user) {
          user = await prisma.user.findUnique({
            where: { twitchUserId: providerAccountId },
            include: { wallets: true, channel: { select: safeChannelSelect } },
          });
        }

        if (!user) {
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

      // Upsert ExternalAccount (either login or link). For Twitch login, also refresh legacy User fields.
      await prisma.$transaction(async (tx) => {
        // IMPORTANT (Google/YouTube):
        // Google часто НЕ возвращает refresh_token при повторном consent, даже если access_type=offline.
        // Нельзя затирать уже сохранённый refreshToken значением null, иначе последующие API-вызовы (channels.list mine=true)
        // перестанут работать после истечения access token.
        const externalUpdate: any = {
          userId: user.id,
          displayName,
          login,
          avatarUrl,
          profileUrl,
          accessToken,
          tokenExpiresAt,
          scopes,
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

        if (provider === 'twitch') {
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
        // Supported providers: youtube, vkvideo, twitch.
        if ((provider === 'youtube' || provider === 'vkvideo' || provider === 'twitch') && stateKind === 'bot_link') {
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
              await (tx as any).youTubeBotIntegration.upsert({
                where: { channelId },
                create: { channelId, externalAccountId: upserted.id, enabled: true },
                update: { externalAccountId: upserted.id, enabled: true },
                select: { id: true },
              });
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
              await (tx as any).vkVideoBotIntegration.upsert({
                where: { channelId },
                create: { channelId, externalAccountId: upserted.id, enabled: true },
                update: { externalAccountId: upserted.id, enabled: true },
                select: { id: true },
              });
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
              await (tx as any).twitchBotIntegration.upsert({
                where: { channelId },
                create: { channelId, externalAccountId: upserted.id, enabled: true },
                update: { externalAccountId: upserted.id, enabled: true },
                select: { id: true },
              });
            }
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
      const scopes = ['https://www.googleapis.com/auth/youtube.readonly'];
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
    } else {
      // Providers without implemented OAuth yet: kick / trovo / boosty.
      const redirectUrl = getRedirectUrl(req);
      return res.redirect(buildRedirectWithError(redirectUrl, redirectTo, { error: 'auth_failed', reason: 'provider_not_supported', provider }));
    }

    return res.redirect(authUrl!);
  },

  handleLinkCallback: async (req: AuthRequest, res: Response) => {
    // Same handler: the state.kind determines whether this becomes login or link.
    return authController.handleCallback(req, res);
  },

  listAccounts: async (req: AuthRequest, res: Response) => {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const accounts = await prisma.externalAccount.findMany({
      where: { userId: req.userId },
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

    const count = await prisma.externalAccount.count({ where: { userId: req.userId } });
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

