import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { createOAuthState } from '../../auth/oauthState.js';
import { getTwitchAuthorizeUrl } from '../../auth/providers/twitch.js';
import { hasChannelEntitlement } from '../../utils/entitlements.js';
import {
  DEFAULT_INTEGRATION_STATUS,
  formatIntegrationStatus,
  isPrismaFeatureUnavailable,
  requireChannelId,
  sanitizeRedirectTo,
} from './botIntegrationsShared.js';

export const twitchBotController = {
  // GET /streamer/bots/twitch/bot
  // Returns current per-channel bot override status (if configured).
  twitchBotStatus: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    try {
      const row = await prisma.twitchBotIntegration.findUnique({
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

  // GET /streamer/bots/twitch/bot/link
  // Starts OAuth linking for a per-channel Twitch bot account, stored as mapping to this channel.
  twitchBotLinkStart: async (req: AuthRequest, res: Response) => {
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

    const clientId = process.env.TWITCH_CLIENT_ID;
    const callbackUrl = process.env.TWITCH_CALLBACK_URL;
    if (!clientId || !callbackUrl || !process.env.TWITCH_CLIENT_SECRET) {
      return res.status(503).json({ error: 'Service Unavailable', message: 'Twitch OAuth is not configured' });
    }

    const redirectTo = sanitizeRedirectTo(req.query.redirect_to);
    const origin = (req.query.origin as string) || null;

    const { state } = await createOAuthState({
      provider: 'twitch',
      kind: 'bot_link',
      userId: req.userId,
      channelId,
      redirectTo,
      origin,
    });

    const authUrl = getTwitchAuthorizeUrl({
      clientId,
      redirectUri: callbackUrl,
      state,
      scopes: ['chat:read', 'chat:edit'],
    });

    return res.redirect(authUrl);
  },

  // DELETE /streamer/bots/twitch/bot
  // Removes per-channel bot override (falls back to global bot token).
  twitchBotUnlink: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    try {
      await prisma.twitchBotIntegration.deleteMany({ where: { channelId } });
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
