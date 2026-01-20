import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { setupRoutes } from '../src/routes/index.js';
import {
  createChannel,
  createExternalAccount,
  createGlobalModerator,
  createUser,
  createWallet,
} from './factories/index.js';

function rand(): string {
  return Math.random().toString(16).slice(2);
}

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

describe('viewer /me', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.PORT = '3001';
    process.env.DOMAIN = 'example.com';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.REDIS_URL = '';
    process.env.AI_BULLMQ_ENABLED = '0';
    process.env.CHAT_OUTBOX_BULLMQ_ENABLED = '0';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns user data with channel, wallets, external accounts, and global moderator flag', async () => {
    const channel = await createChannel({
      slug: `chan_${rand()}`,
      name: 'Main Channel',
    });
    const user = await createUser({
      displayName: 'Viewer',
      role: 'viewer',
      channelId: channel.id,
      profileImageUrl: 'https://cdn.example.com/avatar.png',
    });
    await createGlobalModerator({ userId: user.id, revokedAt: null });

    await createWallet({ userId: user.id, channelId: channel.id, balance: 123 });
    const otherChannel = await createChannel({ slug: `other_${rand()}`, name: 'Other Channel' });
    await createWallet({ userId: user.id, channelId: otherChannel.id, balance: 50 });

    const t1 = new Date('2024-01-01T00:00:00.000Z');
    const t2 = new Date('2024-01-02T00:00:00.000Z');
    const t3 = new Date('2024-01-03T00:00:00.000Z');

    await createExternalAccount({
      userId: user.id,
      provider: 'youtube',
      providerAccountId: `yt_${rand()}`,
      login: 'UC123456',
      displayName: 'YT Channel',
      profileUrl: null,
      createdAt: t1,
    });
    await createExternalAccount({
      userId: user.id,
      provider: 'vkvideo',
      providerAccountId: `vkvideo_${rand()}`,
      login: 'vklogin',
      displayName: null,
      profileUrl: '@vkuser',
      createdAt: t2,
    });
    await createExternalAccount({
      userId: user.id,
      provider: 'vkplay',
      providerAccountId: `vkplay_${rand()}`,
      login: 'vkplay_user',
      displayName: 'VKPlay',
      profileUrl: 'https://vkplay.example.com/user',
      createdAt: t3,
    });

    const token = makeJwt({ userId: user.id, role: user.role, channelId: user.channelId });
    const res = await request(makeApp())
      .get('/me')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(res.body?.id).toBe(user.id);
    expect(res.body?.displayName).toBe(user.displayName);
    expect(res.body?.profileImageUrl).toBe(user.profileImageUrl);
    expect(res.body?.role).toBe(user.role);
    expect(res.body?.isGlobalModerator).toBe(true);
    expect(res.body?.channelId).toBe(channel.id);
    expect(res.body?.channel).toEqual({ id: channel.id, slug: channel.slug, name: channel.name });

    expect(Array.isArray(res.body?.wallets)).toBe(true);
    const walletIds = (res.body.wallets as Array<{ channelId: string }>).map((w) => w.channelId);
    expect(walletIds).toEqual(expect.arrayContaining([channel.id, otherChannel.id]));

    expect(Array.isArray(res.body?.externalAccounts)).toBe(true);
    const externalAccounts = res.body.externalAccounts as Array<{
      provider: string;
      login: string | null;
      displayName: string | null;
      profileUrl: string | null;
    }>;

    const youtube = externalAccounts.find((a) => a.provider === 'youtube');
    expect(youtube?.profileUrl).toBe('https://www.youtube.com/channel/UC123456');

    const vkvideo = externalAccounts.find((a) => a.provider === 'vkvideo');
    expect(vkvideo?.profileUrl).toBe('https://live.vkvideo.ru/vkuser');
    expect(vkvideo?.displayName).toBe('vklogin');

    const vk = externalAccounts.find((a) => a.provider === 'vk');
    expect(vk?.profileUrl).toBe('https://vkplay.example.com/user');
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(makeApp()).get('/me').set('Host', 'example.com');

    expect(res.status).toBe(401);
    expect(res.body?.errorCode).toBe('UNAUTHORIZED');
  });
});
