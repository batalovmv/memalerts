import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { prisma } from '../src/lib/prisma.js';
import { webhookRoutes } from '../src/routes/webhooks.js';
import { createChannel } from './factories/index.js';

function makeApp() {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as { rawBody?: Buffer }).rawBody = buf;
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

function rand(): string {
  return Math.random().toString(16).slice(2);
}

describe('Twitch follow EventSub payloads without auto rewards', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.TWITCH_EVENTSUB_SECRET = process.env.TWITCH_EVENTSUB_SECRET || 'test_eventsub_secret';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('does not create coin grants when auto rewards are not configured', async () => {
    const channel = await createChannel({
      slug: `ch_${rand()}`,
      name: `Channel ${rand()}`,
      twitchChannelId: `tw_${rand()}`,
    });

    const event = {
      user_id: `u_${rand()}`,
      user_login: 'viewer_login',
      user_name: 'Viewer',
      broadcaster_user_id: channel.twitchChannelId,
      broadcaster_user_login: 'broadcaster_login',
      broadcaster_user_name: 'Broadcaster',
      followed_at: new Date().toISOString(),
    };

    const body = { subscription: { type: 'channel.follow' }, event };
    const secret = process.env.TWITCH_EVENTSUB_SECRET!;

    // First delivery
    {
      const rawBody = JSON.stringify(body);
      const messageId = `m_${rand()}`;
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
    }

    // Retry / second follow (different delivery id)
    {
      const rawBody = JSON.stringify(body);
      const messageId = `m_${rand()}`;
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
    }

    const pendingCount = await prisma.pendingCoinGrant.count({
      where: { provider: 'twitch', providerAccountId: event.user_id, channelId: channel.id },
    });
    expect(pendingCount).toBe(0);

    const evCount = await prisma.externalRewardEvent.count({
      where: {
        provider: 'twitch',
        providerAccountId: event.user_id,
        channelId: channel.id,
      },
    });
    expect(evCount).toBe(0);
  });
});
