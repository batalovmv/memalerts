import type { CookieOptions, Response } from 'express';
import type { SignOptions } from 'jsonwebtoken';
import { signJwt } from '../../../utils/jwt.js';
import type { AuthRequest } from '../../../middleware/auth.js';
import type { ExternalAccountProvider, OAuthStateKind } from '@prisma/client';
import { debugLog } from '../../../utils/debug.js';
import { logger } from '../../../utils/logger.js';
import { DEFAULT_LINK_REDIRECT, getRedirectUrl, sanitizeRedirectTo } from '../utils.js';
type AuthenticatedUserWithRelations = {
  id: string;
  role: string;
  channelId: string | null;
  channel?: { slug?: string | null } | null;
  hasBetaAccess: boolean;
};

type FinalizeAuthParams = {
  req: AuthRequest;
  res: Response;
  user: AuthenticatedUserWithRelations;
  provider: ExternalAccountProvider;
  stateKind?: OAuthStateKind;
  stateOrigin?: string;
  stateRedirectTo?: string;
  stateValue?: string | string[];
  botLinkSubscriptionDenied: boolean;
  botLinkSubscriptionDeniedProvider: string | null;
};

export function finalizeAuthResponse(params: FinalizeAuthParams) {
  const redirectUrl = getRedirectUrl(params.req, params.stateOrigin);

  const isBetaRedirect =
    (params.stateOrigin && params.stateOrigin.includes('beta.')) || (redirectUrl && redirectUrl.includes('beta.'));

  const isBetaBackend = process.env.DOMAIN?.includes('beta.') || process.env.PORT === '3002';
  const isBetaLogin = isBetaRedirect || (params.stateOrigin && params.stateOrigin.includes('beta.'));

  debugLog('[BETA_ACCESS_DEBUG] Checking conditions', {
    isBetaBackend,
    isBetaLogin,
    hasBetaAccess: params.user.hasBetaAccess,
    domain: process.env.DOMAIN,
    port: process.env.PORT,
    stateOrigin: params.stateOrigin,
    redirectUrl,
  });

  debugLog('[BETA_ACCESS_DEBUG] Beta login context (no auto-grant)', {
    isBetaBackend,
    isBetaLogin,
    hasBetaAccess: params.user.hasBetaAccess,
    domain: process.env.DOMAIN,
    port: process.env.PORT,
    stateOrigin: params.stateOrigin,
    redirectUrl,
  });

  debugLog('User created/found, generating JWT...');

  const isProductionBackend = !process.env.DOMAIN?.includes('beta.') && process.env.PORT !== '3002';
  const isBetaCallback = params.stateOrigin && params.stateOrigin.includes('beta.');
  const requestHost = params.req.get('host') || '';
  const callbackCameToProduction = !requestHost.includes('beta.');

  if (isProductionBackend && isBetaCallback && callbackCameToProduction) {
    const tempToken = signJwt(
      {
        userId: params.user.id,
        role: params.user.role,
        channelId: params.user.channelId,
        tempForBeta: true,
      },
      { expiresIn: '5m' } as SignOptions
    );

    const betaAuthUrl = `${params.stateOrigin}/auth/twitch/complete?token=${encodeURIComponent(
      tempToken
    )}&state=${encodeURIComponent(String(params.stateValue || ''))}`;
    debugLog('Redirecting to beta backend for cookie setup:', betaAuthUrl);
    params.res.redirect(betaAuthUrl);
    return;
  }

  const token = signJwt(
    {
      userId: params.user.id,
      role: params.user.role,
      channelId: params.user.channelId,
    },
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as SignOptions
  );

  const isProduction = process.env.NODE_ENV === 'production';

  if (isProductionBackend && isBetaCallback && callbackCameToProduction) {
    debugLog('Production backend received beta callback, will redirect to beta backend after token exchange');
  }

  let cookieDomain: string | undefined;

  if (isBetaRedirect) {
    try {
      const urlToParse = redirectUrl || params.stateOrigin;
      if (urlToParse) {
        const url = new URL(urlToParse);
        const hostname = url.hostname;
        cookieDomain = hostname;
      }
    } catch {
      // ignore
    }
  }

  const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  };

  if (cookieDomain) {
    cookieOptions.domain = cookieDomain;
  }

  debugLog('Setting cookie with options:', {
    httpOnly: cookieOptions.httpOnly,
    secure: cookieOptions.secure,
    sameSite: cookieOptions.sameSite,
    path: cookieOptions.path,
    domain: cookieOptions.domain,
    maxAge: cookieOptions.maxAge,
    isProduction,
    stateOrigin: params.stateOrigin,
    cookieDomain,
    'cookieDomain set': !!cookieDomain,
  });

  const cookieName = isBetaRedirect ? 'token_beta' : 'token';
  params.res.cookie(cookieName, token, cookieOptions);

  const setCookieHeader = params.res.getHeader('Set-Cookie');
  debugLog('Set-Cookie header:', setCookieHeader);
  debugLog('Response headers before redirect:', Object.keys(params.res.getHeaders()));

  if (!setCookieHeader) {
    logger.warn('auth.callback.set_cookie_missing');
  }

  let redirectPath = '/';

  if (params.stateRedirectTo) {
    redirectPath = sanitizeRedirectTo(params.stateRedirectTo);
    debugLog('Using redirectTo from state:', redirectPath);
  } else if (params.stateKind === 'link') {
    redirectPath = DEFAULT_LINK_REDIRECT;
  } else if (params.stateKind === 'login' && params.user.role === 'streamer' && params.user.channel?.slug) {
    redirectPath = '/dashboard';
    debugLog('Redirecting streamer to dashboard (no redirectTo in state)');
  } else {
    redirectPath = '/';
    debugLog('Redirecting to home (default)');
  }

  let finalRedirectUrl = `${redirectUrl}${redirectPath}`;

  if (params.stateRedirectTo && params.stateRedirectTo !== redirectPath) {
    finalRedirectUrl = `${redirectUrl}${redirectPath}`;
  }

  if (params.botLinkSubscriptionDenied) {
    try {
      const u = new URL(finalRedirectUrl);
      u.searchParams.set('error', 'auth_failed');
      u.searchParams.set('reason', 'subscription_required');
      u.searchParams.set('provider', params.botLinkSubscriptionDeniedProvider || params.provider);
      finalRedirectUrl = u.toString();
    } catch {
      // ignore
    }
  }

  debugLog('Auth successful, redirecting to:', {
    finalRedirectUrl,
    redirectPath,
    stateRedirectTo: params.stateRedirectTo,
  });

  if (params.provider === 'vkvideo') {
    logger.info('oauth.vkvideo.callback.final_redirect', {
      provider: 'vkvideo',
      final_redirect: redirectPath,
      base: redirectUrl,
      state_redirect: params.stateRedirectTo ? sanitizeRedirectTo(params.stateRedirectTo) : null,
      state_kind: params.stateKind,
    });
  }

  params.res.status(302).redirect(finalRedirectUrl);
}
