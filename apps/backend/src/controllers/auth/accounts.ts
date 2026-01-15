import type { CookieOptions, Response } from 'express';
import type { SignOptions } from 'jsonwebtoken';
import { signJwt, verifyJwtWithRotation } from '../../utils/jwt.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { logAuthEvent } from '../../utils/auditLogger.js';
import { debugLog } from '../../utils/debug.js';
import { logger } from '../../utils/logger.js';
import { asRecord, getRedirectUrl } from './utils.js';

export async function listAccounts(req: AuthRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

  const accounts = await prisma.externalAccount.findMany({
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
}

export async function unlinkAccount(req: AuthRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const externalAccountId = String(asRecord(req.params)?.externalAccountId || '').trim();
  if (!externalAccountId) return res.status(400).json({ error: 'Bad Request' });

  const row = await prisma.externalAccount.findFirst({
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
  const rowRec = asRecord(row);
  const hasId = (value: unknown): boolean => Boolean(asRecord(value).id);
  const isBotCredential =
    hasId(rowRec.youTubeBotIntegration) ||
    hasId(rowRec.globalYouTubeBotCredential) ||
    hasId(rowRec.vkVideoBotIntegration) ||
    hasId(rowRec.globalVkVideoBotCredential) ||
    hasId(rowRec.twitchBotIntegration) ||
    hasId(rowRec.globalTwitchBotCredential) ||
    hasId(rowRec.trovoBotIntegration) ||
    hasId(rowRec.globalTrovoBotCredential) ||
    hasId(rowRec.kickBotIntegration) ||
    hasId(rowRec.globalKickBotCredential);

  if (isBotCredential) {
    const provider = String(rowRec.provider || '').toLowerCase();
    const hintByProvider: Record<string, string> = {
      youtube:
        'Use DELETE /owner/bots/youtube/default (global) or DELETE /streamer/bots/youtube/bot (per-channel override).',
      twitch:
        'Use DELETE /owner/bots/twitch/default (global) or DELETE /streamer/bots/twitch/bot (per-channel override).',
      vkvideo:
        'Use DELETE /owner/bots/vkvideo/default (global) or DELETE /streamer/bots/vkvideo/bot (per-channel override).',
      trovo:
        'Use DELETE /owner/bots/trovo/default (global) or DELETE /streamer/bots/trovo/bot (per-channel override).',
      kick: 'Use DELETE /owner/bots/kick/default (global) or DELETE /streamer/bots/kick/bot (per-channel override).',
    };

    const isGlobal =
      hasId(rowRec.globalYouTubeBotCredential) ||
      hasId(rowRec.globalVkVideoBotCredential) ||
      hasId(rowRec.globalTwitchBotCredential) ||
      hasId(rowRec.globalTrovoBotCredential) ||
      hasId(rowRec.globalKickBotCredential);
    const kind = isGlobal ? 'global_bot_credential' : 'channel_bot_credential';
    const unlinkEndpoint =
      provider === 'youtube'
        ? isGlobal
          ? 'DELETE /owner/bots/youtube/default'
          : 'DELETE /streamer/bots/youtube/bot'
        : provider === 'twitch'
          ? isGlobal
            ? 'DELETE /owner/bots/twitch/default'
            : 'DELETE /streamer/bots/twitch/bot'
          : provider === 'vkvideo'
            ? isGlobal
              ? 'DELETE /owner/bots/vkvideo/default'
              : 'DELETE /streamer/bots/vkvideo/bot'
            : provider === 'trovo'
              ? isGlobal
                ? 'DELETE /owner/bots/trovo/default'
                : 'DELETE /streamer/bots/trovo/bot'
              : provider === 'kick'
                ? isGlobal
                  ? 'DELETE /owner/bots/kick/default'
                  : 'DELETE /streamer/bots/kick/bot'
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

  const count = await prisma.externalAccount.count({
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
}

export async function logout(req: AuthRequest, res: Response) {
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };

  const host = (req.get('host') || '').split(':')[0];
  const baseDomain = process.env.DOMAIN || 'twitchmemes.ru';
  const domainVariants = Array.from(
    new Set<string | undefined>([
      undefined,
      host || undefined,
      baseDomain || undefined,
      baseDomain ? `beta.${baseDomain.replace(/^beta\./, '')}` : undefined,
      baseDomain ? baseDomain.replace(/^beta\./, '') : undefined,
    ])
  );

  for (const domain of domainVariants) {
    const opts = domain ? { ...cookieOptions, domain } : cookieOptions;
    res.clearCookie('token', opts);
    res.clearCookie('token_beta', opts);
  }

  if (req.userId) {
    await logAuthEvent('logout', req.userId, true, req);
  }

  res.json({ message: 'Logged out successfully' });
}

export async function completeBetaAuth(req: AuthRequest, res: Response) {
  const { token, state } = req.query;

  if (!token || typeof token !== 'string') {
    return res.redirect('/?error=auth_failed&reason=no_token');
  }

  try {
    const decoded = verifyJwtWithRotation<{
      userId: string;
      role: string;
      channelId?: string;
      tempForBeta?: boolean;
    }>(token, 'auth_complete_beta');

    if (!decoded.tempForBeta) {
      return res.redirect('/?error=auth_failed&reason=invalid_token');
    }

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

    const betaToken = signJwt(
      {
        userId: decoded.userId,
        role: decoded.role,
        channelId: decoded.channelId,
      },
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as SignOptions
    );

    const isProduction = process.env.NODE_ENV === 'production';
    const redirectUrl = getRedirectUrl(req, stateOrigin);

    let cookieDomain: string | undefined;
    if (redirectUrl && redirectUrl.includes('beta.')) {
      try {
        const url = new URL(redirectUrl);
        cookieDomain = url.hostname;
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

    res.cookie('token_beta', betaToken, cookieOptions);

    const finalRedirectUrl = `${redirectUrl}${redirectPath}`;
    debugLog('Beta auth completed, redirecting to:', finalRedirectUrl);
    res.redirect(finalRedirectUrl);
  } catch (error) {
    const err = error as Error;
    logger.error('auth.beta_complete_failed', { errorMessage: err.message });
    res.redirect('/?error=auth_failed&reason=token_verification_failed');
  }
}
