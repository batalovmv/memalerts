import { beforeEach, describe, expect, it, vi } from 'vitest';

const twitchApiMocks = vi.hoisted(() => ({
  createEventSubSubscriptionOfType: vi.fn(),
  getEventSubSubscriptions: vi.fn(),
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
  DEFAULT_BREAK_CREDIT_MINUTES,
  DEFAULT_FOLLOW_GREETING_TEMPLATE,
  DEFAULT_STREAM_DURATION_TEMPLATE,
  DEFAULT_STREAM_DURATION_TRIGGER,
} from '../src/services/bot/botShared.js';
import {
  createChannel,
  createChatBotCommand,
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

    twitchApiMocks.getEventSubSubscriptions.mockResolvedValue({ data: [] });
    twitchApiMocks.createEventSubSubscriptionOfType.mockResolvedValue({ ok: true });
    twitchApiMocks.getTwitchLoginByUserId.mockResolvedValue('streamer_login');
  });

  it('creates, lists, updates, and deletes bot commands', async () => {
    const channel = await createChannel({ slug: 'bot-commands', name: 'Bot Commands' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = makeApp();

    const createRes = await request(app)
      .post('/streamer/bot/commands')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
      .send({
        trigger: '!hello',
        response: 'Hello world',
        onlyWhenLive: true,
        allowedRoles: ['VIP', 'moderator', 'vip'],
        allowedUsers: ['User1', '@User2', 'user1'],
        vkvideoAllowedRoleIds: ['role-1', 'role-1', 'role-2'],
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.trigger).toBe('!hello');
    expect(createRes.body.response).toBe('Hello world');
    expect(createRes.body.onlyWhenLive).toBe(true);
    expect(createRes.body.allowedRoles).toEqual(['vip', 'moderator']);
    expect(createRes.body.allowedUsers).toEqual(['user1', 'user2']);
    expect(createRes.body.vkvideoAllowedRoleIds).toEqual(['role-1', 'role-2']);

    const listRes = await request(app)
      .get('/streamer/bot/commands')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(listRes.status).toBe(200);
    expect(listRes.body.items).toHaveLength(1);
    expect(listRes.body.items[0].id).toBe(createRes.body.id);

    const patchRes = await request(app)
      .patch(`/streamer/bot/commands/${createRes.body.id}`)
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
      .send({
        enabled: false,
        onlyWhenLive: false,
        allowedRoles: ['vip'],
        allowedUsers: ['another_user'],
        vkvideoAllowedRoleIds: ['role-3'],
      });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.enabled).toBe(false);
    expect(patchRes.body.onlyWhenLive).toBe(false);
    expect(patchRes.body.allowedRoles).toEqual(['vip']);
    expect(patchRes.body.allowedUsers).toEqual(['another_user']);
    expect(patchRes.body.vkvideoAllowedRoleIds).toEqual(['role-3']);

    const deleteRes = await request(app)
      .delete(`/streamer/bot/commands/${createRes.body.id}`)
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.ok).toBe(true);
  });

  it('rejects duplicate bot commands by trigger', async () => {
    const channel = await createChannel({ slug: 'bot-commands-dupe', name: 'Bot Commands Dupe' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = makeApp();

    await createChatBotCommand({ channelId: channel.id, trigger: '!dup', triggerNormalized: '!dup' });

    const createRes = await request(app)
      .post('/streamer/bot/commands')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
      .send({ trigger: '!dup', response: 'Duplicate' });

    expect(createRes.status).toBe(409);
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

  it('manages follow greeting configuration', async () => {
    const channel = await createChannel({
      slug: 'bot-follow',
      name: 'Bot Follow',
      twitchChannelId: 'twitch-follow',
    });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = makeApp();

    const enableRes = await request(app)
      .post('/streamer/bot/follow-greetings/enable')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
      .send({ followGreetingTemplate: 'Hello {user}' });

    expect(enableRes.status).toBe(200);
    expect(enableRes.body.ok).toBe(true);
    expect(enableRes.body.followGreetingsEnabled).toBe(true);
    expect(enableRes.body.followGreetingTemplate).toBe('Hello {user}');
    expect(twitchApiMocks.getEventSubSubscriptions).toHaveBeenCalledWith(
      expect.stringContaining('twitch-follow')
    );
    expect(twitchApiMocks.createEventSubSubscriptionOfType).toHaveBeenCalled();

    const patchRes = await request(app)
      .patch('/streamer/bot/follow-greetings')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
      .send({ followGreetingTemplate: 'Welcome {user}' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.followGreetingTemplate).toBe('Welcome {user}');

    const disableRes = await request(app)
      .post('/streamer/bot/follow-greetings/disable')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(disableRes.status).toBe(200);
    expect(disableRes.body.followGreetingsEnabled).toBe(false);
  });

  it('returns follow greeting defaults when not configured', async () => {
    const channel = await createChannel({ slug: 'bot-follow-default', name: 'Bot Follow Default' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = makeApp();

    const getRes = await request(app)
      .get('/streamer/bot/follow-greetings')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(getRes.status).toBe(200);
    expect(getRes.body.followGreetingsEnabled).toBe(false);
    expect(getRes.body.followGreetingTemplate).toBe(DEFAULT_FOLLOW_GREETING_TEMPLATE);
  });

  it('manages stream duration configuration', async () => {
    const channel = await createChannel({ slug: 'bot-duration', name: 'Bot Duration' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = makeApp();

    const defaultRes = await request(app)
      .get('/streamer/bot/stream-duration')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(defaultRes.status).toBe(200);
    expect(defaultRes.body.enabled).toBe(false);
    expect(defaultRes.body.trigger).toBe(DEFAULT_STREAM_DURATION_TRIGGER);
    expect(defaultRes.body.responseTemplate).toBe(DEFAULT_STREAM_DURATION_TEMPLATE);
    expect(defaultRes.body.breakCreditMinutes).toBe(DEFAULT_BREAK_CREDIT_MINUTES);

    const patchRes = await request(app)
      .patch('/streamer/bot/stream-duration')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
      .send({
        enabled: true,
        trigger: '!uptime',
        responseTemplate: 'Up {hours}h',
        breakCreditMinutes: 45.7,
        onlyWhenLive: true,
      });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.enabled).toBe(true);
    expect(patchRes.body.trigger).toBe('!uptime');
    expect(patchRes.body.responseTemplate).toBe('Up {hours}h');
    expect(patchRes.body.breakCreditMinutes).toBe(45);
    expect(patchRes.body.onlyWhenLive).toBe(true);

    const getRes = await request(app)
      .get('/streamer/bot/stream-duration')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(getRes.status).toBe(200);
    expect(getRes.body.enabled).toBe(true);
    expect(getRes.body.trigger).toBe('!uptime');
    expect(getRes.body.responseTemplate).toBe('Up {hours}h');
    expect(getRes.body.breakCreditMinutes).toBe(45);
    expect(getRes.body.onlyWhenLive).toBe(true);
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
