import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { createOAuthState } from '../../auth/oauthState.js';
import { getTrovoAuthorizeUrl } from '../../auth/providers/trovo.js';
import { hasChannelEntitlement } from '../../utils/entitlements.js';
import { ERROR_CODES } from '../../shared/errors.js';
import {
  DEFAULT_INTEGRATION_STATUS,
  formatIntegrationStatus,
  isPrismaFeatureUnavailable,
  requireChannelId,
  sanitizeRedirectTo,
} from './botIntegrationsShared.js';

export const trovoBotController = {
  // GET /streamer/bots/trovo/bot
  // Returns current per-channel Trovo bot override status (if configured).
  trovoBotStatus: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    try {
      const row = await prisma.trovoBotIntegration.findUnique({
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

  // GET /streamer/bots/trovo/bot/link
  // Starts OAuth linking for a per-channel Trovo bot account (chat scopes), stored as mapping to this channel.
  trovoBotLinkStart: async (req: AuthRequest, res: Response) => {
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

    const clientId = process.env.TROVO_CLIENT_ID;
    const callbackUrl = process.env.TROVO_CALLBACK_URL;
    const clientSecret = process.env.TROVO_CLIENT_SECRET;
    if (!clientId || !callbackUrl || !clientSecret) {
      return res.status(503).json({
        errorCode: ERROR_CODES.BOT_NOT_CONFIGURED,
        error: 'Trovo OAuth is not configured',
        requestId: req.requestId,
        details: {
          provider: 'trovo',
          missing: [
            !clientId ? 'TROVO_CLIENT_ID' : null,
            !clientSecret ? 'TROVO_CLIENT_SECRET' : null,
            !callbackUrl ? 'TROVO_CALLBACK_URL' : null,
          ].filter(Boolean),
        },
      });
    }

    const redirectTo = sanitizeRedirectTo(req.query.redirect_to);
    const origin = (req.query.origin as string) || null;

    const { state } = await createOAuthState({
      provider: 'trovo',
      kind: 'bot_link',
      userId: req.userId,
      channelId,
      redirectTo,
      origin,
    });

    const scopes = String(process.env.TROVO_BOT_SCOPES || process.env.TROVO_SCOPES || '')
      .split(/[ ,+]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const authUrl = getTrovoAuthorizeUrl({
      clientId,
      redirectUri: callbackUrl,
      state,
      scopes,
    });

    return res.redirect(authUrl);
  },

  // DELETE /streamer/bots/trovo/bot
  // Removes per-channel Trovo bot override (falls back to global Trovo bot credential).
  trovoBotUnlink: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    try {
      await prisma.trovoBotIntegration.deleteMany({ where: { channelId } });
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
