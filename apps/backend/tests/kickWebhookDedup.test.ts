import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { prisma } from '../src/lib/prisma.js';
import { setupRoutes } from '../src/routes/index.js';

function rand(): string {
  return Math.random().toString(16).slice(2);
}

describe('webhooks: /webhooks/kick/events', () => {
  it('dedups by Kick-Event-Message-Id (delivery idempotency)', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.KICK_WEBHOOK_PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    process.env.KICK_WEBHOOK_REPLAY_WINDOW_MS = String(10 * 60 * 1000);

    const channel = await prisma.channel.create({
      data: {
        slug: `ch_${rand()}`,
        name: `Channel ${rand()}`,
        kickRewardEnabled: true,
        kickCoinPerPointRatio: 2.0,
      } as any,
      select: { id: true, slug: true },
    });
    const user = await prisma.user.create({
      data: { displayName: `Streamer ${rand()}`, role: 'streamer', hasBetaAccess: true } as any,
      select: { id: true },
    });

    await (prisma as any).kickChatBotSubscription.create({
      data: {
        channelId: channel.id,
        userId: user.id,
        kickChannelId: 'kick_ch_1',
        enabled: true,
      },
    });

    const payload = {
      type: 'channel.reward.redemption.updated',
      data: {
        event: {
          redemption: {
            id: `red_${rand()}`,
            status: 'accepted',
            redeemed_at: new Date().toISOString(),
            channel: { id: 'kick_ch_1' },
            redeemer: { id: `kick_user_${rand()}` },
            reward: { id: `rw_${rand()}`, cost: 10 },
          },
        },
      },
    };

    const rawBody = JSON.stringify(payload);
    const messageId = `msg_${rand()}`;
    const ts = String(Date.now());
    const message = `${messageId}.${ts}.${rawBody}`;
    const signature = crypto
      .sign('RSA-SHA256', Buffer.from(message, 'utf8'), { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING })
      .toString('base64');

    const app = express();
    app.use(express.json());
    setupRoutes(app);

    let res = await request(app)
      .post('/webhooks/kick/events')
      .set('Content-Type', 'application/json')
      .set('Kick-Event-Message-Id', messageId)
      .set('Kick-Event-Message-Timestamp', ts)
      .set('Kick-Event-Signature', signature)
      .send(rawBody);
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);

    res = await request(app)
      .post('/webhooks/kick/events')
      .set('Content-Type', 'application/json')
      .set('Kick-Event-Message-Id', messageId)
      .set('Kick-Event-Message-Timestamp', ts)
      .set('Kick-Event-Signature', signature)
      .send(rawBody);
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.duplicate).toBe(true);

    const pending = await (prisma as any).pendingCoinGrant.count({
      where: { provider: 'kick', channelId: channel.id },
    });
    expect(pending).toBe(1);

    const dedups = await (prisma as any).externalWebhookDeliveryDedup.count({
      where: { provider: 'kick', messageId },
    });
    expect(dedups).toBe(1);
  });
});


