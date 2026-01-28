import type { Response } from 'express';
import type { AuthRequest } from '../../../middleware/auth.js';
import type { ExternalAccountProvider, OAuthStateKind } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { loadAndConsumeOAuthState } from '../../../auth/oauthState.js';
import { resolveOAuthProvider } from '../../../auth/oauthProviders/registry.js';
import { OAuthProviderError } from '../../../auth/oauthProviders/errors.js';
import { logger } from '../../../utils/logger.js';
import { debugError, debugLog } from '../../../utils/debug.js';
import { ERROR_CODES } from '../../../shared/errors.js';
import {
  emitWalletUpdated,
  relayWalletUpdatedToPeer,
  type WalletUpdatedEvent,
} from '../../../realtime/walletBridge.js';
import type { Server } from 'socket.io';
import { applyExternalAccount } from './applyExternalAccount.js';
import { finalizeAuthResponse } from './finalizeAuthResponse.js';
import { asRecord, buildRedirectWithError, getRedirectUrl, sanitizeRedirectTo, wantsJson } from '../utils.js';

type AuthenticatedUserWithRelations = Awaited<ReturnType<typeof prisma.user.findUnique>>;

export async function handleCallback(req: AuthRequest, res: Response) {
  const safeChannelSelect = {
    id: true,
    slug: true,
    name: true,
    twitchChannelId: true,
    rewardIdForCoins: true,
    coinPerPointRatio: true,
    createdAt: true,
  } as const;

  const providerFromUrl = String(asRecord(req.params)?.provider || '')
    .trim()
    .toLowerCase() as ExternalAccountProvider;

  const query = asRecord(req.query);
  const { code, error, state } = req.query;
  const errorDescription = query.error_description;
  const requestId = req.requestId;

  const stateId = typeof state === 'string' ? state : '';
  const consumed = await loadAndConsumeOAuthState(stateId);
  const consumedRow = asRecord(consumed.row);
  const stateOrigin = consumed.ok && typeof consumedRow.origin === 'string' ? consumedRow.origin : undefined;
  const stateRedirectTo =
    consumed.ok && typeof consumedRow.redirectTo === 'string' ? consumedRow.redirectTo : undefined;
  const stateKind: OAuthStateKind | undefined =
    consumed.ok && typeof consumedRow.kind === 'string' ? (consumedRow.kind as OAuthStateKind) : undefined;
  const stateUserId: string | undefined = consumed.ok
    ? String(consumedRow.userId || '').trim() || undefined
    : undefined;
  const stateChannelId: string | undefined = consumed.ok
    ? String(consumedRow.channelId || '').trim() || undefined
    : undefined;
  const stateCodeVerifier: string | undefined = consumed.ok
    ? String(consumedRow.codeVerifier || '').trim() || undefined
    : undefined;
  const providerFromState: ExternalAccountProvider | undefined =
    consumed.ok && typeof consumedRow.provider === 'string'
      ? (consumedRow.provider as ExternalAccountProvider)
      : undefined;

  const provider: ExternalAccountProvider = providerFromState ?? providerFromUrl;

  const isVkVideo = provider === 'vkvideo';
  const codePreview = typeof code === 'string' ? code.slice(0, 8) : '';
  const statePreview = typeof stateId === 'string' ? stateId.slice(0, 12) : '';
  const stateFound = consumed.ok ? true : consumed.reason !== 'state_not_found';
  const verifierFound = consumed.ok ? !!stateCodeVerifier : Boolean(consumedRow.codeVerifier);
  const errorDescPreview = typeof errorDescription === 'string' ? errorDescription.slice(0, 180) : undefined;

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
    logger.error('auth.callback.oauth_error', { provider, error, errorDescription });
    const redirectUrl = getRedirectUrl(req, stateOrigin);

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
    logger.error('auth.callback.missing_code');
    const redirectUrl = getRedirectUrl(req, stateOrigin);
    return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_code`);
  }

  let diagProviderAccountId: string | null = null;
  let diagResolvedUserId: string | null = null;
  let diagExistingExternalUserId: string | null = null;

  try {
    if (!consumed.ok) {
      const redirectUrl = getRedirectUrl(req);
      return res.redirect(`${redirectUrl}/?error=auth_failed&reason=${consumed.reason}`);
    }

    if (stateKind !== 'login' && stateKind !== 'link' && stateKind !== 'bot_link') {
      const redirectUrl = getRedirectUrl(req, stateOrigin);
      return res.redirect(`${redirectUrl}/?error=auth_failed&reason=invalid_state_kind`);
    }

    if (stateKind === 'login' && provider !== 'twitch') {
      const redirectUrl = getRedirectUrl(req, stateOrigin);
      return res.redirect(`${redirectUrl}/?error=auth_failed&reason=login_not_supported&provider=${provider}`);
    }

    debugLog('Exchanging code for token...', { provider, stateKind });

    const oauthProvider = resolveOAuthProvider(provider);
    if (!oauthProvider) {
      const redirectUrl = getRedirectUrl(req, stateOrigin);
      return res.redirect(`${redirectUrl}/?error=auth_failed&reason=provider_not_supported&provider=${provider}`);
    }

    let profile: Awaited<ReturnType<typeof oauthProvider.exchangeCode>>;
    try {
      profile = await oauthProvider.exchangeCode({
        code: code as string,
        req,
        stateKind,
        statePreview,
        stateCodeVerifier,
        stateUserId,
        stateOrigin,
      });
    } catch (providerError) {
      if (providerError instanceof OAuthProviderError) {
        const redirectUrl = getRedirectUrl(req, stateOrigin);
        const providerParam = providerError.includeProviderParam
          ? `&provider=${providerError.provider ?? provider}`
          : '';
        return res.redirect(`${redirectUrl}/?error=auth_failed&reason=${providerError.reason}${providerParam}`);
      }
      throw providerError;
    }

    const {
      providerAccountId,
      displayName,
      login,
      avatarUrl,
      profileUrl,
      accessToken,
      refreshToken,
      tokenExpiresAt,
      scopes,
    } = profile;

    diagProviderAccountId = providerAccountId;

    const existingExternal = await prisma.externalAccount.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId } },
      select: { id: true, userId: true },
    });
    diagExistingExternalUserId = existingExternal?.userId ?? null;

    let user: AuthenticatedUserWithRelations | null = null;

    if (stateKind === 'link' || stateKind === 'bot_link') {
      if (!stateUserId) {
        const redirectUrl = getRedirectUrl(req, stateOrigin);
        return res.redirect(`${redirectUrl}/?error=auth_failed&reason=missing_link_user`);
      }
      if (existingExternal && existingExternal.userId !== stateUserId) {
        const redirectUrl = getRedirectUrl(req, stateOrigin);
        const redirectPath = sanitizeRedirectTo(stateRedirectTo || '/settings/accounts');
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

      user = await prisma.user.findUnique({
        where: { id: stateUserId },
        include: { wallets: true, channel: { select: safeChannelSelect } },
      });
      if (!user) {
        const redirectUrl = getRedirectUrl(req, stateOrigin);
        return res.redirect(`${redirectUrl}/?error=auth_failed&reason=user_not_found`);
      }
    } else {
      if (provider !== 'twitch') {
        const redirectUrl = getRedirectUrl(req, stateOrigin);
        return res.redirect(`${redirectUrl}/?error=auth_failed&reason=login_not_supported&provider=${provider}`);
      }

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

    if (!user) {
      const redirectUrl = getRedirectUrl(req, stateOrigin);
      return res.redirect(`${redirectUrl}/?error=auth_failed&reason=user_not_found`);
    }

    const resolvedStateKind = stateKind as OAuthStateKind;
    const applyResult = await applyExternalAccount({
      provider,
      providerAccountId,
      user,
      stateKind: resolvedStateKind,
      statePreview,
      stateChannelId,
      displayName,
      login,
      avatarUrl,
      profileUrl,
      accessToken,
      refreshToken,
      tokenExpiresAt,
      scopes,
      requestId,
    });

    const claimedWalletEvents: WalletUpdatedEvent[] = applyResult.claimedWalletEvents;

    user = await prisma.user.findUnique({
      where: { id: user.id },
      include: { wallets: true, channel: { select: safeChannelSelect } },
    });

    if (!user) {
      logger.error('auth.callback.user_missing_after_upsert');
      const redirectUrl = getRedirectUrl(req, stateOrigin);
      return res.redirect(`${redirectUrl}/?error=auth_failed&reason=user_null`);
    }

    if (claimedWalletEvents.length > 0) {
      try {
        const io: Server = req.app.get('io');
        for (const ev of claimedWalletEvents) {
          emitWalletUpdated(io, ev);
          void relayWalletUpdatedToPeer(ev);
        }
      } catch (error: unknown) {
        logger.warn('external_rewards.wallet_emit_failed', {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const stateValue = (() => {
      if (typeof state === 'string') return state;
      if (Array.isArray(state)) return state.filter((item): item is string => typeof item === 'string');
      return undefined;
    })();

    finalizeAuthResponse({
      req,
      res,
      user,
      provider,
      stateKind: resolvedStateKind,
      stateOrigin,
      stateRedirectTo,
      stateValue,
      botLinkSubscriptionDenied: applyResult.botLinkSubscriptionDenied,
      botLinkSubscriptionDeniedProvider: applyResult.botLinkSubscriptionDeniedProvider,
    });
  } catch (error) {
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

    logger.error('auth.callback.error', { errorMessage: error instanceof Error ? error.message : String(error) });
    debugError('Auth error (debug)', error);
    if (providerFromUrl === 'vkvideo') {
      logger.error('oauth.vkvideo.callback.exception', {
        provider: 'vkvideo',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
    if (error instanceof Error) {
      logger.error('auth.callback.error_detail', { errorMessage: error.message, stack: error.stack });
      if (error.message.includes('P2002') || error.message.includes('Unique constraint')) {
        logger.error('auth.callback.unique_constraint_violation');
      }
      if (error.message.includes('P2003') || error.message.includes('Foreign key constraint')) {
        logger.error('auth.callback.foreign_key_violation');
      }
    }
    logger.error('auth.callback.error_full', {
      errorObject: JSON.stringify(error, Object.getOwnPropertyNames(error)),
    });

    let fallbackStateOrigin: string | undefined;
    if (req.query.state && typeof req.query.state === 'string') {
      try {
        const row = await prisma.oAuthState.findUnique({ where: { state: req.query.state } });
        fallbackStateOrigin = row?.origin || undefined;
      } catch {
        // ignore
      }
    }

    const redirectUrl = getRedirectUrl(req, fallbackStateOrigin);
    const errorReason = error instanceof Error ? encodeURIComponent(error.message.substring(0, 100)) : 'unknown';
    res.redirect(`${redirectUrl}/?error=auth_failed&reason=exception&details=${errorReason}`);
  }
}

export function handleTwitchCallback(req: AuthRequest, res: Response) {
  asRecord(req.params).provider = 'twitch';
  return handleCallback(req, res);
}

export function handleLinkCallback(req: AuthRequest, res: Response) {
  return handleCallback(req, res);
}
