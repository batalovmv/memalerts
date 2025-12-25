import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { hasChannelEntitlement } from '../../utils/entitlements.js';

export const streamerEntitlementsController = {
  // GET /streamer/entitlements/custom-bot
  // Returns entitlement status for the authenticated streamer's channel.
  customBot: async (req: AuthRequest, res: Response) => {
    const channelId = String(req.channelId || '').trim();
    if (!channelId) return res.status(400).json({ error: 'Bad Request', message: 'Missing channelId' });

    const entitled = await hasChannelEntitlement(channelId, 'custom_bot');
    return res.json({ entitled });
  },
};


