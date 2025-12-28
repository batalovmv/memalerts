import express from 'express';
import request from 'supertest';
import crypto from 'crypto';

import { webhookRoutes } from '../src/routes/webhooks.js';

function makeApp() {
  const app = express();
  // Capture raw body to validate that signature check uses raw bytes (whitespace matters).
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf;
      },
    })
  );
  app.use('/webhooks', webhookRoutes);
  return app;
}

function signEventSub(secret: string, messageId: string, timestamp: string, rawBody: string): string {
  const hmacMessage = messageId + timestamp + rawBody;
  const hmac = crypto.createHmac('sha256', secret).update(hmacMessage).digest('hex');
  return `sha256=${hmac}`;
}

describe('Twitch EventSub webhook /webhooks/twitch/eventsub', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.TWITCH_EVENTSUB_SECRET = process.env.TWITCH_EVENTSUB_SECRET || 'test_eventsub_secret';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('responds to challenge without requiring signature headers', async () => {
    const body = {
      challenge: 'abc123',
      subscription: { status: 'webhook_callback_verification_pending' },
    };
    const res = await request(makeApp()).post('/webhooks/twitch/eventsub').send(body);
    expect(res.status).toBe(200);
    expect(res.text).toBe('abc123');
  });

  it('rejects requests with missing signature headers', async () => {
    const body = { subscription: { type: 'something' }, event: {} };
    const res = await request(makeApp()).post('/webhooks/twitch/eventsub').send(body);
    expect(res.status).toBe(403);
    expect(res.body?.error).toBe('Missing signature headers');
  });

  it('rejects invalid signature', async () => {
    const body = { subscription: { type: 'something' }, event: {} };
    const res = await request(makeApp())
      .post('/webhooks/twitch/eventsub')
      .set('twitch-eventsub-message-id', 'm1')
      .set('twitch-eventsub-message-timestamp', String(Date.now()))
      .set('twitch-eventsub-message-signature', 'sha256=deadbeef')
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body?.error).toBe('Invalid signature');
  });

  it('rejects too-old timestamp even with valid signature', async () => {
    const secret = process.env.TWITCH_EVENTSUB_SECRET!;
    const body = { subscription: { type: 'something' }, event: {} };
    const rawBody = JSON.stringify(body);
    const messageId = 'm2';
    const oldTs = String(Date.now() - 11 * 60 * 1000);
    const sig = signEventSub(secret, messageId, oldTs, rawBody);

    const res = await request(makeApp())
      .post('/webhooks/twitch/eventsub')
      .set('twitch-eventsub-message-id', messageId)
      .set('twitch-eventsub-message-timestamp', oldTs)
      .set('twitch-eventsub-message-signature', sig)
      .set('Content-Type', 'application/json')
      .send(rawBody);
    expect(res.status).toBe(403);
    expect(res.body?.error).toBe('Request too old');
  });

  it('accepts valid signature + timestamp for unknown events', async () => {
    const secret = process.env.TWITCH_EVENTSUB_SECRET!;
    // Intentionally include whitespace; signature must use raw body.
    const rawBody = '{\"subscription\": {\"type\": \"something.unknown\"}, \"event\": {\"ok\": true}}';
    const messageId = 'm3';
    const ts = String(Date.now());
    const sig = signEventSub(secret, messageId, ts, rawBody);

    const res = await request(makeApp())
      .post('/webhooks/twitch/eventsub')
      .set('twitch-eventsub-message-id', messageId)
      .set('twitch-eventsub-message-timestamp', ts)
      .set('twitch-eventsub-message-signature', sig)
      .set('Content-Type', 'application/json')
      .send(rawBody);
    expect(res.status).toBe(200);
    expect(res.body?.message).toBe('Event received');
  });

  it('accepts RFC3339 timestamp header format (Twitch default)', async () => {
    const secret = process.env.TWITCH_EVENTSUB_SECRET!;
    const rawBody = '{\"subscription\": {\"type\": \"something.unknown\"}, \"event\": {\"ok\": true}}';
    const messageId = 'm4';
    const ts = new Date().toISOString();
    const sig = signEventSub(secret, messageId, ts, rawBody);

    const res = await request(makeApp())
      .post('/webhooks/twitch/eventsub')
      .set('twitch-eventsub-message-id', messageId)
      .set('twitch-eventsub-message-timestamp', ts)
      .set('twitch-eventsub-message-signature', sig)
      .set('Content-Type', 'application/json')
      .send(rawBody);
    expect(res.status).toBe(200);
    expect(res.body?.message).toBe('Event received');
  });

  it('rejects invalid timestamp format even with valid signature', async () => {
    const secret = process.env.TWITCH_EVENTSUB_SECRET!;
    const rawBody = '{\"subscription\": {\"type\": \"something.unknown\"}, \"event\": {\"ok\": true}}';
    const messageId = 'm5';
    const ts = 'not-a-timestamp';
    const sig = signEventSub(secret, messageId, ts, rawBody);

    const res = await request(makeApp())
      .post('/webhooks/twitch/eventsub')
      .set('twitch-eventsub-message-id', messageId)
      .set('twitch-eventsub-message-timestamp', ts)
      .set('twitch-eventsub-message-signature', sig)
      .set('Content-Type', 'application/json')
      .send(rawBody);
    expect(res.status).toBe(403);
    expect(res.body?.error).toBe('Invalid timestamp');
  });
});


