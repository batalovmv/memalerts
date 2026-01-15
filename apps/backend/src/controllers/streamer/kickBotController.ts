import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { createOAuthState } from '../../auth/oauthState.js';
import { getKickAuthorizeUrl } from '../../auth/providers/kick.js';
import { hasChannelEntitlement } from '../../utils/entitlements.js';
import { ERROR_CODES } from '../../shared/errors.js';
import {
  DEFAULT_INTEGRATION_STATUS,
  formatIntegrationStatus,
  isPrismaFeatureUnavailable,
  requireChannelId,
  sanitizeRedirectTo,
} from './botIntegrationsShared.js';

export const kickBotController = {
  // GET /streamer/bots/kick/bot
  // Returns current per-channel Kick bot override status (if configured).
  kickBotStatus: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    try {
      const row = await prisma.kickBotIntegration.findUnique({
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

  // GET /streamer/bots/kick/bot/link
  // Starts OAuth linking for a per-channel Kick bot account (chat scopes), stored as mapping to this channel.
  kickBotLinkStart: async (req: AuthRequest, res: Response) => {
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

    const clientId = process.env.KICK_CLIENT_ID;
    const callbackUrl = process.env.KICK_CALLBACK_URL;
    const authorizeUrl = process.env.KICK_AUTHORIZE_URL;
    const tokenUrl = process.env.KICK_TOKEN_URL;
    const refreshUrl = process.env.KICK_REFRESH_URL;
    const userInfoUrl = process.env.KICK_USERINFO_URL;
    const clientSecret = process.env.KICK_CLIENT_SECRET;
    if (!clientId || !callbackUrl || !authorizeUrl || !tokenUrl || !refreshUrl || !userInfoUrl || !clientSecret) {
      return res.status(503).json({
        errorCode: ERROR_CODES.BOT_NOT_CONFIGURED,
        error: 'Kick OAuth is not configured',
        requestId: req.requestId,
        details: {
          provider: 'kick',
          missing: [
            !clientId ? 'KICK_CLIENT_ID' : null,
            !clientSecret ? 'KICK_CLIENT_SECRET' : null,
            !callbackUrl ? 'KICK_CALLBACK_URL' : null,
            !authorizeUrl ? 'KICK_AUTHORIZE_URL' : null,
            !tokenUrl ? 'KICK_TOKEN_URL' : null,
            !refreshUrl ? 'KICK_REFRESH_URL' : null,
            !userInfoUrl ? 'KICK_USERINFO_URL' : null,
          ].filter(Boolean),
        },
      });
    }

    const redirectTo = sanitizeRedirectTo(req.query.redirect_to);
    const origin = (req.query.origin as string) || null;

    const { state } = await createOAuthState({
      provider: 'kick',
      kind: 'bot_link',
      userId: req.userId,
      channelId,
      redirectTo,
      origin,
    });

    const scopes = String(process.env.KICK_BOT_SCOPES || process.env.KICK_SCOPES || '')
      .split(/[ ,+]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const authUrl = getKickAuthorizeUrl({
      authorizeUrl,
      clientId,
      redirectUri: callbackUrl,
      state,
      scopes,
    });

    return res.redirect(authUrl);
  },

  // DELETE /streamer/bots/kick/bot
  // Removes per-channel Kick bot override (falls back to global Kick bot credential).
  kickBotUnlink: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    try {
      await prisma.kickBotIntegration.deleteMany({ where: { channelId } });
      return res.json({ ok: true });
    } catch (error) {
      if (isPrismaFeatureUnavailable(error)) {
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      }
      throw error;
    }
  },
};
