import { beforeEach, describe, expect, it, vi } from 'vitest';

const twitchApiMocks = vi.hoisted(() => ({
  getTwitchLoginByUserId: vi.fn(),
}));
const queueMocks = vi.hoisted(() => ({
  enqueueChatOutboxJob: vi.fn(),
}));

vi.mock('../src/utils/twitchApi.js', async () => {
  const actual = await vi.importActual('../src/utils/twitchApi.js');
  return { ...actual, ...twitchApiMocks };
});
vi.mock('../src/queues/chatOutboxQueue.js', () => queueMocks);

import cookieParser from 'cookie-parser';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { prisma } from '../src/lib/prisma.js';
import { setupRoutes } from '../src/routes/index.js';
import {
  createChannel,
  createChatBotSubscription,
  createUser,
  createYouTubeChatBotSubscription,
} from './factories/index.js';

function makeJwt(payload: Record<string, unknown>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.set('io', { to: () => ({ emit: () => {} }) });
  setupRoutes(app);
  return app;
}

describe('bot service', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.PORT = '3001';
    process.env.DOMAIN = 'example.com';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.TWITCH_EVENTSUB_SECRET = 'eventsub-secret';
    process.env.REDIS_URL = '';
    process.env.AI_BULLMQ_ENABLED = '0';
    process.env.CHAT_OUTBOX_BULLMQ_ENABLED = '0';

    twitchApiMocks.getTwitchLoginByUserId.mockResolvedValue('streamer_login');
  });

  it('manages Twitch bot subscription state', async () => {
    const channel = await createChannel({
      slug: 'bot-subscription',
      name: 'Bot Subscription',
      twitchChannelId: 'twitch-123',
    });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = makeApp();

    const enableRes = await request(app)
      .post('/streamer/bot/enable')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(enableRes.status).toBe(200);
    expect(enableRes.body.ok).toBe(true);

    const subscription = await prisma.chatBotSubscription.findUnique({ where: { channelId: channel.id } });
    expect(subscription?.enabled).toBe(true);
    expect(subscription?.twitchLogin).toBe('streamer_login');

    const statusRes = await request(app)
      .get('/streamer/bot/subscription')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.enabled).toBe(true);

    const disableRes = await request(app)
      .post('/streamer/bot/disable')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(disableRes.status).toBe(200);
    expect(disableRes.body.ok).toBe(true);

    const disabled = await prisma.chatBotSubscription.findUnique({ where: { channelId: channel.id } });
    expect(disabled?.enabled).toBe(false);
  });

  it('requires provider when multiple chat bots are enabled', async () => {
    const channel = await createChannel({ slug: 'bot-multi', name: 'Bot Multi' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = makeApp();

    await createChatBotSubscription({ channelId: channel.id, twitchLogin: 'streamer_login', enabled: true });
    await createYouTubeChatBotSubscription({
      channelId: channel.id,
      userId: streamer.id,
      youtubeChannelId: 'youtube-1',
      enabled: true,
    });

    const sayRes = await request(app)
      .post('/streamer/bot/say')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
      .send({ message: 'Hello' });

    expect(sayRes.status).toBe(400);
    expect(sayRes.body.enabledProviders).toEqual(['twitch', 'youtube']);
  });

  it('enqueues outbox messages and returns status', async () => {
    const channel = await createChannel({ slug: 'bot-outbox', name: 'Bot Outbox' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = makeApp();

    await createChatBotSubscription({ channelId: channel.id, twitchLogin: 'streamer_login', enabled: true });

    const sayRes = await request(app)
      .post('/streamer/bot/say')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
      .send({ provider: 'twitch', message: 'Ping' });

    expect(sayRes.status).toBe(200);
    expect(sayRes.body.ok).toBe(true);
    expect(sayRes.body.provider).toBe('twitch');
    expect(queueMocks.enqueueChatOutboxJob).toHaveBeenCalledWith({
      platform: 'twitch',
      outboxId: sayRes.body.outbox.id,
      channelId: channel.id,
    });

    const statusRes = await request(app)
      .get(`/streamer/bot/outbox/twitch/${sayRes.body.outbox.id}`)
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.provider).toBe('twitch');
    expect(statusRes.body.id).toBe(sayRes.body.outbox.id);
    expect(statusRes.body.status).toBe('pending');
    expect(statusRes.body.createdAt).toBeTypeOf('string');
  });
});
