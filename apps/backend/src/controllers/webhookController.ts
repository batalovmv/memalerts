import type { Request, Response } from 'express';
import { handleTwitchRedemptionEvent } from './webhook/twitchEventSubRedemption.js';
import { handleTwitchStreamSessionEvent } from './webhook/twitchEventSubStreamSession.js';
import { type EventSubContext } from './webhook/twitchEventSubShared.js';
import { verifyEventSubRequest } from './webhook/twitchEventSubVerification.js';

export const webhookController = {
  handleEventSub: async (req: Request, res: Response) => {
    if (req.body.subscription && req.body.subscription.status === 'webhook_callback_verification_pending') {
      const challenge = req.body.challenge;
      return res.status(200).send(challenge);
    }

    const verified = verifyEventSubRequest(req);
    if (!verified.ok) {
      return res.status(verified.status).json({ error: verified.error });
    }

    const subscriptionType = String(req.body?.subscription?.type || '').trim();
    const ctx: EventSubContext = {
      req,
      res,
      messageId: verified.messageId,
      messageTimestamp: verified.messageTimestamp,
      rawBody: verified.rawBody,
      subscriptionType,
    };

    if (await handleTwitchRedemptionEvent(ctx)) return;
    if (await handleTwitchStreamSessionEvent(ctx)) return;

    res.status(200).json({ message: 'Event received' });
  },
};
