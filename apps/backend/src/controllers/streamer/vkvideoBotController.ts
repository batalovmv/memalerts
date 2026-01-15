import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { createOAuthState } from '../../auth/oauthState.js';
import { generatePkceVerifier, getVkVideoAuthorizeUrl, pkceChallengeS256 } from '../../auth/providers/vkvideo.js';
import { hasChannelEntitlement } from '../../utils/entitlements.js';
import {
  DEFAULT_INTEGRATION_STATUS,
  formatIntegrationStatus,
  isPrismaFeatureUnavailable,
  requireChannelId,
  sanitizeRedirectTo,
} from './botIntegrationsShared.js';

const parseVkVideoBotScopes = (): string[] => {
  const raw = String(process.env.VKVIDEO_BOT_SCOPES || process.env.VKVIDEO_SCOPES || '').trim();
  return raw
    .split(/[ ,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
};

export const vkvideoBotController = {
  // GET /streamer/bots/vkvideo/bot
  // Returns current per-channel bot override status (if configured).
  vkvideoBotStatus: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    try {
      const row = await prisma.vkVideoBotIntegration.findUnique({
        where: { channelId },
        select: { enabled: true, externalAccountId: true, updatedAt: true },
      });
      if (!row) return res.json({ ...DEFAULT_INTEGRATION_STATUS, lockedBySubscription: false });
      const entitled = await hasChannelEntitlement(channelId, 'custom_bot');
      return res.json({ ...formatIntegrationStatus(row), lockedBySubscription: !entitled });
    } catch (error) {
      if (isPrismaFeatureUnavailable(error)) {
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      }
      throw error;
    }
  },

  // GET /streamer/bots/vkvideo/bot/link
  // Starts OAuth linking for a per-channel VKVideo bot account, stored as mapping to this channel.
  vkvideoBotLinkStart: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const entitled = await hasChannelEntitlement(channelId, 'custom_bot');
    if (!entitled) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'Custom bot sender is available only with subscription.',
      });
    }

    const clientId = process.env.VKVIDEO_CLIENT_ID;
    const callbackUrl = process.env.VKVIDEO_CALLBACK_URL;
    const authorizeUrl = process.env.VKVIDEO_AUTHORIZE_URL;
    if (!clientId || !callbackUrl || !authorizeUrl || !process.env.VKVIDEO_CLIENT_SECRET) {
      return res.status(503).json({ error: 'Service Unavailable', message: 'VKVideo OAuth is not configured' });
    }

    const redirectTo = sanitizeRedirectTo(req.query.redirect_to);
    const origin = (req.query.origin as string) || null;

    const pkceVerifier = generatePkceVerifier();
    const pkceChallenge = pkceChallengeS256(pkceVerifier);

    const { state } = await createOAuthState({
      provider: 'vkvideo',
      kind: 'bot_link',
      userId: req.userId,
      channelId,
      redirectTo,
      origin,
      codeVerifier: pkceVerifier,
    });

    const scopes = parseVkVideoBotScopes();
    const authUrl = getVkVideoAuthorizeUrl({
      authorizeUrl,
      clientId,
      redirectUri: callbackUrl,
      state,
      codeChallenge: pkceChallenge,
      scopes,
    });

    return res.redirect(authUrl);
  },

  // DELETE /streamer/bots/vkvideo/bot
  // Removes per-channel bot override (falls back to global bot token).
  vkvideoBotUnlink: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    try {
      await prisma.vkVideoBotIntegration.deleteMany({ where: { channelId } });
      return res.json({ ok: true });
    } catch (error) {
      const prismaError = error as { code?: string };
      if (prismaError.code === 'P2021') {
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      }
      throw error;
    }
  },
};
