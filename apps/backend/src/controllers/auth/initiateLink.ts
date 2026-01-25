import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { resolveOAuthProvider } from '../../auth/oauthProviders/registry.js';
import { OAuthProviderError } from '../../auth/oauthProviders/errors.js';
import {
  asRecord,
  buildRedirectWithError,
  getRedirectUrl,
  sanitizeRedirectTo,
  DEFAULT_LINK_REDIRECT,
  sanitizeOrigin,
} from './utils.js';

export async function initiateYouTubeForceSslLink(req: AuthRequest, res: Response) {
  const query = asRecord(req.query);
  if (!req.userId) {
    const redirectUrl = getRedirectUrl(req);
    return res.redirect(`${redirectUrl}/?error=auth_required&reason=no_session`);
  }

  const redirectTo = sanitizeRedirectTo(query.redirect_to);
  const origin = sanitizeOrigin(query.origin, req);

  try {
    const oauthProvider = resolveOAuthProvider('youtube');
    if (!oauthProvider) {
      const redirectUrl = getRedirectUrl(req);
      return res.redirect(
        buildRedirectWithError(redirectUrl, redirectTo, {
          error: 'auth_failed',
          reason: 'provider_not_supported',
          provider: 'youtube',
        })
      );
    }

    const { authUrl } = await oauthProvider.buildAuthorizeUrl({
      kind: 'link',
      userId: req.userId,
      redirectTo,
      origin,
      scopeHint: 'force_ssl',
    });

    return res.redirect(authUrl);
  } catch (error) {
    if (error instanceof OAuthProviderError) {
      const redirectUrl = getRedirectUrl(req);
      return res.redirect(
        buildRedirectWithError(redirectUrl, redirectTo, {
          error: 'auth_failed',
          reason: error.reason,
          provider: 'youtube',
        })
      );
    }
    throw error;
  }
}

export async function initiateLink(req: AuthRequest, res: Response) {
  const providerInput = String(asRecord(req.params)?.provider || '')
    .trim()
    .toLowerCase();
  if (!req.userId) {
    const redirectUrl = getRedirectUrl(req);
    return res.redirect(`${redirectUrl}/?error=auth_required&reason=no_session`);
  }

  const rawRedirectTo = req.query.redirect_to;
  const redirectTo = sanitizeRedirectTo(rawRedirectTo);
  const origin = sanitizeOrigin(req.query.origin, req);

  if (providerInput === 'boosty') {
    const redirectUrl = getRedirectUrl(req, origin || undefined);
    const url = new URL(`${redirectUrl}${redirectTo || DEFAULT_LINK_REDIRECT}`);
    url.searchParams.set('provider', 'boosty');
    url.searchParams.set('mode', 'manual');
    return res.redirect(url.toString());
  }

  const oauthProvider = resolveOAuthProvider(providerInput);
  if (!oauthProvider || !oauthProvider.supportsLink) {
    const redirectUrl = getRedirectUrl(req);
    return res.redirect(
      buildRedirectWithError(redirectUrl, redirectTo, {
        error: 'auth_failed',
        reason: 'provider_not_supported',
        provider: providerInput,
      })
    );
  }

  try {
    const { authUrl } = await oauthProvider.buildAuthorizeUrl({
      kind: 'link',
      userId: req.userId,
      redirectTo,
      origin,
    });
    return res.redirect(authUrl);
  } catch (error) {
    if (error instanceof OAuthProviderError) {
      const redirectUrl = getRedirectUrl(req);
      return res.redirect(
        buildRedirectWithError(redirectUrl, redirectTo, {
          error: 'auth_failed',
          reason: error.reason,
          provider: oauthProvider.id,
        })
      );
    }
    throw error;
  }
}
