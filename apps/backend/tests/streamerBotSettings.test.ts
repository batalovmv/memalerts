import { beforeEach, describe, expect, it, vi } from 'vitest';

const twitchApiMocks = vi.hoisted(() => ({
  getTwitchLoginByUserId: vi.fn(),
}));
const youtubeApiMocks = vi.hoisted(() => ({
  fetchMyYouTubeChannelIdDetailed: vi.fn(),
  getValidYouTubeBotAccessToken: vi.fn(),
  getYouTubeExternalAccount: vi.fn(),
}));
const youtubeAuthMocks = vi.hoisted(() => ({
  fetchGoogleTokenInfo: vi.fn(),
}));
const trovoApiMocks = vi.hoisted(() => ({
  getTrovoExternalAccount: vi.fn(),
  getValidTrovoBotAccessToken: vi.fn(),
}));
const trovoAuthMocks = vi.hoisted(() => ({
  fetchTrovoUserInfo: vi.fn(),
}));
const vkvideoApiMocks = vi.hoisted(() => ({
  getValidVkVideoBotAccessToken: vi.fn(),
  getVkVideoExternalAccount: vi.fn(),
  fetchVkVideoCurrentUser: vi.fn(),
}));
const kickApiMocks = vi.hoisted(() => ({
  createKickEventSubscription: vi.fn(),
  getKickExternalAccount: vi.fn(),
  getValidKickAccessTokenByExternalAccountId: vi.fn(),
  getValidKickBotAccessToken: vi.fn(),
  listKickEventSubscriptions: vi.fn(),
}));

vi.mock('../src/utils/twitchApi.js', async () => {
  const actual = await vi.importActual('../src/utils/twitchApi.js');
  return { ...actual, ...twitchApiMocks };
});
vi.mock('../src/utils/youtubeApi.js', async () => {
  const actual = await vi.importActual('../src/utils/youtubeApi.js');
  return { ...actual, ...youtubeApiMocks };
});
vi.mock('../src/auth/providers/youtube.js', async () => {
  const actual = await vi.importActual('../src/auth/providers/youtube.js');
  return { ...actual, ...youtubeAuthMocks };
});
vi.mock('../src/utils/trovoApi.js', async () => {
  const actual = await vi.importActual('../src/utils/trovoApi.js');
  return { ...actual, ...trovoApiMocks };
});
vi.mock('../src/auth/providers/trovo.js', async () => {
  const actual = await vi.importActual('../src/auth/providers/trovo.js');
  return { ...actual, ...trovoAuthMocks };
});
vi.mock('../src/utils/vkvideoApi.js', async () => {
  const actual = await vi.importActual('../src/utils/vkvideoApi.js');
  return { ...actual, ...vkvideoApiMocks };
});
vi.mock('../src/utils/kickApi.js', async () => {
  const actual = await vi.importActual('../src/utils/kickApi.js');
  return { ...actual, ...kickApiMocks };
});

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { prisma } from '../src/lib/prisma.js';
import { setupRoutes } from '../src/routes/index.js';
import {
  createChannel,
  createChannelEntitlement,
  createTwitchBotIntegration,
  createUser,
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

describe('streamer bot settings', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.PORT = '3001';
    process.env.DOMAIN = 'example.com';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.REDIS_URL = '';
    process.env.AI_BULLMQ_ENABLED = '0';
    process.env.CHAT_OUTBOX_BULLMQ_ENABLED = '0';
    process.env.TROVO_CLIENT_ID = 'trovo-client-id';
    process.env.KICK_CLIENT_ID = 'kick-client-id';
    process.env.KICK_USERINFO_URL = 'https://kick.example/oauth/userinfo';

    twitchApiMocks.getTwitchLoginByUserId.mockResolvedValue('streamer_login');
    youtubeApiMocks.fetchMyYouTubeChannelIdDetailed.mockResolvedValue({ channelId: 'yt-channel' });
    youtubeApiMocks.getValidYouTubeBotAccessToken.mockResolvedValue('yt-bot-token');
    youtubeApiMocks.getYouTubeExternalAccount.mockResolvedValue({
      accessToken: 'yt-access',
      refreshToken: 'yt-refresh',
      scopes: 'scope',
      tokenExpiresAt: new Date(),
    });
    youtubeAuthMocks.fetchGoogleTokenInfo.mockResolvedValue(null);
    trovoApiMocks.getTrovoExternalAccount.mockResolvedValue({ accessToken: 'trovo-user-token' });
    trovoApiMocks.getValidTrovoBotAccessToken.mockResolvedValue('trovo-bot-token');
    trovoAuthMocks.fetchTrovoUserInfo.mockResolvedValue({ user: { channel_id: 'trovo-1' } });
    vkvideoApiMocks.getValidVkVideoBotAccessToken.mockResolvedValue('vkvideo-bot-token');
    vkvideoApiMocks.getVkVideoExternalAccount.mockResolvedValue({ accessToken: 'vk-access' });
    vkvideoApiMocks.fetchVkVideoCurrentUser.mockResolvedValue({ ok: true, data: { channel: { url: 'x' } } });
    kickApiMocks.getKickExternalAccount.mockResolvedValue({
      id: 'kick-acc',
      accessToken: 'kick-user-token',
      scopes: 'events:subscribe',
    });
    kickApiMocks.getValidKickAccessTokenByExternalAccountId.mockResolvedValue('kick-access');
    kickApiMocks.getValidKickBotAccessToken.mockResolvedValue('kick-bot-token');
    kickApiMocks.listKickEventSubscriptions.mockResolvedValue({ ok: true, subscriptions: [] });
    kickApiMocks.createKickEventSubscription.mockResolvedValue({ ok: true, subscriptionId: 'sub-1' });
  });

  it('enables bots for all providers and lists settings', async () => {
    const channel = await createChannel({
      slug: 'bot-settings',
      name: 'Bot Settings',
      twitchChannelId: 'twitch-123',
    });
    await createChannelEntitlement({ channelId: channel.id, key: 'custom_bot', enabled: true });
    await createTwitchBotIntegration({ channelId: channel.id });

    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = makeApp();

    const requests = [
      request(app)
        .patch('/streamer/bots/twitch')
        .set('Host', 'example.com')
        .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
        .send({ enabled: true }),
      request(app)
        .patch('/streamer/bots/youtube')
        .set('Host', 'example.com')
        .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
        .send({ enabled: true }),
      request(app)
        .patch('/streamer/bots/trovo')
        .set('Host', 'example.com')
        .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
        .send({ enabled: true, trovoChannelId: 'trovo-1' }),
      request(app)
        .patch('/streamer/bots/kick')
        .set('Host', 'example.com')
        .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
        .send({ enabled: true, kickChannelId: 'kick-1' }),
      request(app)
        .patch('/streamer/bots/vkvideo')
        .set('Host', 'example.com')
        .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
        .send({ enabled: true, vkvideoChannelId: 'vk-1', vkvideoChannelUrl: 'https://vkvideo.ru/channel/vk-1' }),
    ];

    const results = await Promise.all(requests);
    for (const res of results) {
      expect(res.status).toBe(200);
      expect(res.body?.ok).toBe(true);
    }

    const [twitchSub, youtubeSub, trovoSub, kickSub, vkvideoSub] = await Promise.all([
      prisma.chatBotSubscription.findUnique({ where: { channelId: channel.id } }),
      prisma.youTubeChatBotSubscription.findUnique({ where: { channelId: channel.id } }),
      prisma.trovoChatBotSubscription.findUnique({ where: { channelId: channel.id } }),
      prisma.kickChatBotSubscription.findUnique({ where: { channelId: channel.id } }),
      prisma.vkVideoChatBotSubscription.findUnique({ where: { channelId: channel.id } }),
    ]);

    expect(twitchSub?.enabled).toBe(true);
    expect(youtubeSub?.enabled).toBe(true);
    expect(trovoSub?.enabled).toBe(true);
    expect(kickSub?.enabled).toBe(true);
    expect(vkvideoSub?.enabled).toBe(true);

    const list = await request(app)
      .get('/streamer/bots')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(list.status).toBe(200);
    const items = list.body?.items ?? [];
    const byProvider = new Map(items.map((i: { provider: string; enabled: boolean }) => [i.provider, i.enabled]));
    expect(byProvider.get('twitch')).toBe(true);
    expect(byProvider.get('youtube')).toBe(true);
    expect(byProvider.get('trovo')).toBe(true);
    expect(byProvider.get('kick')).toBe(true);
    expect(byProvider.get('vkvideo')).toBe(true);
  });

  it('validates enabled flag', async () => {
    const channel = await createChannel({ slug: 'bot-settings-validate', name: 'Bot Settings Validate' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });

    const res = await request(makeApp())
      .patch('/streamer/bots/twitch')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
      .send({ enabled: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body?.errorCode).toBe('VALIDATION_ERROR');
  });
});
