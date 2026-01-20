import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { createOAuthState } from '../../auth/oauthState.js';
import { getYouTubeAuthorizeUrl } from '../../auth/providers/youtube.js';
import { hasChannelEntitlement } from '../../utils/entitlements.js';
import {
  DEFAULT_INTEGRATION_STATUS,
  formatIntegrationStatus,
  isPrismaFeatureUnavailable,
  requireChannelId,
  sanitizeRedirectTo,
} from './botIntegrationsShared.js';

export const youtubeBotController = {
  // GET /streamer/bots/youtube/bot
  // Returns current per-channel bot override status (if configured).
  youtubeBotStatus: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    try {
      const row = await prisma.youTubeBotIntegration.findUnique({
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

  // GET /streamer/bots/youtube/bot/link
  // Starts OAuth linking for a per-channel YouTube bot account (force-ssl), stored as mapping to this channel.
  youtubeBotLinkStart: async (req: AuthRequest, res: Response) => {
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

    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const callbackUrl = process.env.YOUTUBE_CALLBACK_URL;
    if (!clientId || !callbackUrl || !process.env.YOUTUBE_CLIENT_SECRET) {
      return res.status(503).json({ error: 'Service Unavailable', message: 'YouTube OAuth is not configured' });
    }

    const redirectTo = sanitizeRedirectTo(req.query.redirect_to);
    const origin = (req.query.origin as string) || null;

    const { state } = await createOAuthState({
      provider: 'youtube',
      kind: 'bot_link',
      userId: req.userId,
      channelId,
      redirectTo,
      origin,
    });

    // For bot sender linking we need a stable Google account id (sub).
    // Google tokeninfo may omit sub/user_id unless OIDC scopes are requested, so include openid scopes too.
    const scopes = ['https://www.googleapis.com/auth/youtube.force-ssl', 'openid', 'email', 'profile'];
    const authUrl = getYouTubeAuthorizeUrl({
      clientId,
      redirectUri: callbackUrl,
      state,
      scopes,
      includeGrantedScopes: true,
    });

    return res.redirect(authUrl);
  },

  // DELETE /streamer/bots/youtube/bot
  // Removes per-channel bot override (falls back to global bot token).
  youtubeBotUnlink: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    try {
      await prisma.youTubeBotIntegration.deleteMany({ where: { channelId } });
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
