import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { prisma } from '../src/lib/prisma.js';
import { webhookRoutes } from '../src/routes/webhooks.js';

function rand(): string {
  return Math.random().toString(16).slice(2);
}

function makeApp() {
  const app = express();
  // Capture raw body bytes (Kick signs raw JSON bytes).
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

async function signKick(payload: any, privateKey: crypto.KeyObject, messageId: string, ts: string): Promise<{ rawBody: string; signature: string }> {
  const rawBody = JSON.stringify(payload);
  const message = `${messageId}.${ts}.${rawBody}`;
  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(message, 'utf8'), { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING })
    .toString('base64');
  return { rawBody, signature };
}

describe('webhooks: /webhooks/kick/events (auto rewards)', () => {
  it('awards follow (channel.followed) using Channel.twitchAutoRewardsJson.follow', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.KICK_WEBHOOK_PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    process.env.KICK_WEBHOOK_REPLAY_WINDOW_MS = String(10 * 60 * 1000);

    const channel = await prisma.channel.create({
      data: {
        slug: `ch_${rand()}`,
        name: `Channel ${rand()}`,
        twitchAutoRewardsJson: { v: 1, follow: { enabled: true, coins: 123, onceEver: true } },
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
        kickChannelId: '123',
        enabled: true,
      },
      select: { id: true },
    });

    const providerAccountId = `kick_u_${rand()}`;
    const payload = {
      type: 'channel.followed',
      data: {
        event: {
          broadcaster: { id: '123' },
          follower: { id: providerAccountId },
          created_at: new Date().toISOString(),
        },
      },
    };

    const messageId = `msg_${rand()}`;
    const ts = new Date().toISOString();
    const { rawBody, signature } = await signKick(payload, privateKey, messageId, ts);

    let res = await request(makeApp())
      .post('/webhooks/kick/events')
      .set('Content-Type', 'application/json')
      .set('Kick-Event-Message-Id', messageId)
      .set('Kick-Event-Message-Timestamp', ts)
      .set('Kick-Event-Type', 'channel.followed')
      .set('Kick-Event-Signature', signature)
      .send(rawBody);
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);

    const pending = await (prisma as any).pendingCoinGrant.findMany({
      where: { provider: 'kick', providerAccountId, channelId: channel.id },
      select: { coinsToGrant: true },
    });
    expect(pending).toHaveLength(1);
    expect(Number(pending[0]?.coinsToGrant ?? 0)).toBe(123);

    // Duplicate delivery must not enqueue twice.
    res = await request(makeApp())
      .post('/webhooks/kick/events')
      .set('Content-Type', 'application/json')
      .set('Kick-Event-Message-Id', messageId)
      .set('Kick-Event-Message-Timestamp', ts)
      .set('Kick-Event-Type', 'channel.followed')
      .set('Kick-Event-Signature', signature)
      .send(rawBody);
    expect(res.status).toBe(200);
    expect(res.body?.duplicate).toBe(true);

    const pendingCount2 = await (prisma as any).pendingCoinGrant.count({
      where: { provider: 'kick', providerAccountId, channelId: channel.id },
    });
    expect(pendingCount2).toBe(1);
  });

  it('awards kicks.gifted using Channel.twitchAutoRewardsJson.cheer (bitsPerCoin/minBits semantics)', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.KICK_WEBHOOK_PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    process.env.KICK_WEBHOOK_REPLAY_WINDOW_MS = String(10 * 60 * 1000);

    const channel = await prisma.channel.create({
      data: {
        slug: `ch_${rand()}`,
        name: `Channel ${rand()}`,
        twitchAutoRewardsJson: { v: 1, cheer: { enabled: true, bitsPerCoin: 10, minBits: 1 } },
      } as any,
      select: { id: true },
    });
    const user = await prisma.user.create({
      data: { displayName: `Streamer ${rand()}`, role: 'streamer', hasBetaAccess: true } as any,
      select: { id: true },
    });

    await (prisma as any).kickChatBotSubscription.create({
      data: {
        channelId: channel.id,
        userId: user.id,
        kickChannelId: '555',
        enabled: true,
      },
      select: { id: true },
    });

    const providerAccountId = `kick_u_${rand()}`;
    const payload = {
      type: 'kicks.gifted',
      data: {
        event: {
          broadcaster: { id: '555' },
          gifter: { id: providerAccountId },
          kicks: 100,
          created_at: new Date().toISOString(),
        },
      },
    };

    const messageId = `msg_${rand()}`;
    const ts = new Date().toISOString();
    const { rawBody, signature } = await signKick(payload, privateKey, messageId, ts);

    const res = await request(makeApp())
      .post('/webhooks/kick/events')
      .set('Content-Type', 'application/json')
      .set('Kick-Event-Message-Id', messageId)
      .set('Kick-Event-Message-Timestamp', ts)
      .set('Kick-Event-Type', 'kicks.gifted')
      .set('Kick-Event-Signature', signature)
      .send(rawBody);
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);

    const pending = await (prisma as any).pendingCoinGrant.findMany({
      where: { provider: 'kick', providerAccountId, channelId: channel.id },
      select: { coinsToGrant: true },
    });
    expect(pending).toHaveLength(1);
    // 100 kicks / 10 "bitsPerCoin" = 10 coins
    expect(Number(pending[0]?.coinsToGrant ?? 0)).toBe(10);
  });
});


