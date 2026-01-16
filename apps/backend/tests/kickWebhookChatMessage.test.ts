import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { webhookRoutes } from '../src/routes/webhooks.js';
import { createChannel, createChatBotCommand, createKickChatBotSubscription, createUser } from './factories/index.js';

function rand(): string {
  return Math.random().toString(16).slice(2);
}

function makeApp() {
  const app = express();
  // Capture raw body bytes (Kick signs raw JSON bytes).
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

describe('webhooks: /webhooks/kick/events (chat.message.sent)', () => {
  it('enqueues Kick outbox reply for matching chat command; dedups by Kick-Event-Message-Id', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.KICK_WEBHOOK_PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    process.env.KICK_WEBHOOK_REPLAY_WINDOW_MS = String(10 * 60 * 1000);

    const channel = await createChannel({
      slug: `ch_${rand()}`,
      name: `Channel ${rand()}`,
    } satisfies Prisma.ChannelCreateInput);
    const user = await createUser({
      displayName: `Streamer ${rand()}`,
      role: 'streamer',
      hasBetaAccess: true,
    } satisfies Prisma.UserCreateInput);

    await createKickChatBotSubscription({
      channelId: channel.id,
      userId: user.id,
      kickChannelId: '123',
      enabled: true,
    });

    await createChatBotCommand({
      channelId: channel.id,
      trigger: 'hello',
      triggerNormalized: 'hello',
      response: 'world',
      enabled: true,
      onlyWhenLive: false,
      allowedUsers: [],
      allowedRoles: [],
    });

    const payload = {
      type: 'chat.message.sent',
      data: {
        event: {
          broadcaster: { id: '123' },
          sender: {
            user_id: `kick_u_${rand()}`,
            username: 'Alice',
            identity: { badges: ['moderator'] },
          },
          message: { content: 'hello' },
        },
      },
    };

    const rawBody = JSON.stringify(payload);
    const messageId = `msg_${rand()}`;
    const ts = new Date().toISOString();
    const message = `${messageId}.${ts}.${rawBody}`;
    const signature = crypto
      .sign('RSA-SHA256', Buffer.from(message, 'utf8'), {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_PADDING,
      })
      .toString('base64');

    let res = await request(makeApp())
      .post('/webhooks/kick/events')
      .set('Content-Type', 'application/json')
      .set('Kick-Event-Message-Id', messageId)
      .set('Kick-Event-Message-Timestamp', ts)
      .set('Kick-Event-Type', 'chat.message.sent')
      .set('Kick-Event-Signature', signature)
      .send(rawBody);
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);

    const outbox1 = await prisma.kickChatBotOutboxMessage.findMany({
      where: { channelId: channel.id },
      select: { id: true, message: true },
    });
    expect(outbox1.length).toBe(1);
    expect(String(outbox1[0]?.message || '')).toBe('world');

    // Duplicate delivery must not enqueue twice.
    res = await request(makeApp())
      .post('/webhooks/kick/events')
      .set('Content-Type', 'application/json')
      .set('Kick-Event-Message-Id', messageId)
      .set('Kick-Event-Message-Timestamp', ts)
      .set('Kick-Event-Type', 'chat.message.sent')
      .set('Kick-Event-Signature', signature)
      .send(rawBody);
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.duplicate).toBe(true);

    const outbox2 = await prisma.kickChatBotOutboxMessage.count({
      where: { channelId: channel.id },
    });
    expect(outbox2).toBe(1);
  });
});

