import crypto from 'crypto';
import type { Request } from 'express';
import { parseEventSubTimestampToMs, safeEqual, type RawBodyRequest } from './twitchEventSubShared.js';

export type EventSubVerificationResult =
  | {
      ok: true;
      rawBody: string;
      messageId: string;
      messageTimestamp: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export function verifyEventSubRequest(req: Request): EventSubVerificationResult {
  const messageId = req.headers['twitch-eventsub-message-id'] as string;
  const messageTimestamp = req.headers['twitch-eventsub-message-timestamp'] as string;
  const messageSignature = req.headers['twitch-eventsub-message-signature'] as string;

  if (!messageId || !messageTimestamp || !messageSignature) {
    return { ok: false, status: 403, error: 'Missing signature headers' };
  }

  const rawBodyReq = req as RawBodyRequest;
  const rawBody =
    rawBodyReq.rawBody && Buffer.isBuffer(rawBodyReq.rawBody)
      ? rawBodyReq.rawBody.toString('utf8')
      : typeof rawBodyReq.rawBody === 'string'
        ? rawBodyReq.rawBody
        : JSON.stringify(req.body);

  const hmacMessage = messageId + messageTimestamp + rawBody;
  const hmac = crypto.createHmac('sha256', process.env.TWITCH_EVENTSUB_SECRET!).update(hmacMessage).digest('hex');
  const expectedSignature = `sha256=${hmac}`;

  if (!safeEqual(messageSignature, expectedSignature)) {
    return { ok: false, status: 403, error: 'Invalid signature' };
  }

  const timestamp = parseEventSubTimestampToMs(messageTimestamp);
  if (!timestamp) {
    return { ok: false, status: 403, error: 'Invalid timestamp' };
  }
  const now = Date.now();
  if (Math.abs(now - timestamp) > 10 * 60 * 1000) {
    return { ok: false, status: 403, error: 'Request too old' };
  }

  return { ok: true, rawBody, messageId, messageTimestamp };
}
