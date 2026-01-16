import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { auditLog, getRequestMetadata } from '../../utils/auditLogger.js';
import {
  normalizeExternalId,
  normalizeProvider,
  isValidTwitchExternalId,
  resolveChannelByProviderExternalId,
} from '../../utils/channelResolve.js';

export const channelResolveController = {
  // GET /owner/channels/resolve?provider=twitch&externalId=12345
  resolve: async (req: AuthRequest, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const provider = normalizeProvider(query.provider);
    const externalId = normalizeExternalId(query.externalId);

    if (!provider || !externalId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'provider and externalId are required',
      });
    }

    // We currently support only Twitch channel id resolution.
    if (provider !== 'twitch') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Unsupported provider',
      });
    }
    if (!isValidTwitchExternalId(externalId)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'externalId must be a numeric Twitch broadcaster_id',
      });
    }

    const { ipAddress, userAgent } = getRequestMetadata(req);
    const actorId = req.userId || null;

    const resolved = await resolveChannelByProviderExternalId(provider, externalId);
    if (!resolved) {
      await auditLog({
        action: 'owner.channels.resolve',
        actorId,
        payload: {
          provider,
          externalId,
          result: 'NOT_FOUND',
        },
        ipAddress,
        userAgent,
        success: false,
        error: 'NOT_FOUND',
      });

      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    await auditLog({
      action: 'owner.channels.resolve',
      actorId,
      channelId: resolved.channelId,
      payload: {
        provider: resolved.provider,
        externalId: resolved.externalId,
        resultChannelId: resolved.channelId,
      },
      ipAddress,
      userAgent,
      success: true,
    });

    return res.json(resolved);
  },
};
