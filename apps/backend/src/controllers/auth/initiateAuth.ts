import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { resolveOAuthProvider } from '../../auth/oauthProviders/registry.js';
import { OAuthProviderError } from '../../auth/oauthProviders/errors.js';
import { debugLog } from '../../utils/debug.js';
import { asRecord, getRedirectUrl } from './utils.js';

export async function initiateAuth(req: AuthRequest, res: Response) {
  const params = asRecord(req.params);
  const query = asRecord(req.query);
  const provider = String(params.provider || '').trim().toLowerCase();
  const oauthProvider = resolveOAuthProvider(provider);
  if (!oauthProvider || !oauthProvider.supportsLogin) {
    const redirectUrl = getRedirectUrl(req);
    return res.redirect(`${redirectUrl}/?error=auth_failed&reason=unsupported_provider`);
  }

  const redirectTo = typeof query.redirect_to === 'string' ? query.redirect_to : null;

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

  try {
    const { authUrl } = await oauthProvider.buildAuthorizeUrl({
      kind: 'login',
      redirectTo,
      origin: originUrl,
    });
    debugLog('auth.initiate', { provider: oauthProvider.id, hasOrigin: !!originUrl, hasRedirectTo: !!redirectTo });
    return res.redirect(authUrl);
  } catch (error) {
    if (error instanceof OAuthProviderError) {
      const redirectUrl = getRedirectUrl(req);
      return res.redirect(`${redirectUrl}/?error=auth_failed&reason=${error.reason}`);
    }
    throw error;
  }
}

export function initiateTwitchAuth(req: AuthRequest, res: Response) {
  asRecord(req.params).provider = 'twitch';
  return initiateAuth(req, res);
}
