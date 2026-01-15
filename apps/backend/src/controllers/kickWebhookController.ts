import type { Response } from 'express';
import { getHeader, type KickWebhookRequest } from './kickWebhookShared.js';
import { getKickEventType, verifyKickSignature } from './kickWebhookVerification.js';
import { handleKickChatMessageSent } from './kickChatEvents.js';
import { handleKickRewardEvents } from './kickRewardEvents.js';

export const kickWebhookController = {
  handleEvents: async (req: KickWebhookRequest, res: Response) => {
    // Kick signs raw request body bytes. Prefer captured rawBody; fallback to JSON.stringify.
    const rawBody =
      req.rawBody && Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {});

    const messageId = getHeader(req, 'Kick-Event-Message-Id') || getHeader(req, 'kick-event-message-id');
    if (!messageId) return res.status(400).json({ error: 'Missing Kick-Event-Message-Id' });

    const sig = await verifyKickSignature({ req, rawBody });
    if (!sig.ok) return res.status(403).json({ error: 'Invalid signature', reason: sig.reason });

    const payload = req.body;
    const eventType = getKickEventType(req, payload);

    if (eventType === 'chat.message.sent') {
      const outcome = await handleKickChatMessageSent({ req, payload, messageId });
      return res.status(outcome.httpStatus).json(outcome.body);
    }

    const outcome = await handleKickRewardEvents({ req, payload, eventType, messageId });
    return res.status(outcome.httpStatus).json(outcome.body);
  },
};
