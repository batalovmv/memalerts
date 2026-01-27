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
  createVkVideoBotIntegration,
  createYouTubeBotIntegration,
} from './factories/index.js';

const VKVIDEO_AUTHORIZE_URL = 'https://vkvideo.example/oauth/authorize';

type ProviderConfig = {
  key: 'twitch' | 'youtube' | 'vkvideo';
  statusPath: string;
  linkPath: string;
  unlinkPath: string;
  authorizeBase: string;
  expectsCodeChallenge?: boolean;
  createIntegration: (args: { channelId: string }) => Promise<unknown>;
};

const PROVIDERS: ProviderConfig[] = [
  {
    key: 'twitch',
    statusPath: '/streamer/bots/twitch/bot',
    linkPath: '/streamer/bots/twitch/bot/link',
    unlinkPath: '/streamer/bots/twitch/bot',
    authorizeBase: 'https://id.twitch.tv/oauth2/authorize',
    createIntegration: ({ channelId }) => createTwitchBotIntegration({ channelId }),
  },
  {
    key: 'youtube',
    statusPath: '/streamer/bots/youtube/bot',
    linkPath: '/streamer/bots/youtube/bot/link',
    unlinkPath: '/streamer/bots/youtube/bot',
    authorizeBase: 'https://accounts.google.com/o/oauth2/v2/auth',
    createIntegration: ({ channelId }) => createYouTubeBotIntegration({ channelId }),
  },
  {
    key: 'vkvideo',
    statusPath: '/streamer/bots/vkvideo/bot',
    linkPath: '/streamer/bots/vkvideo/bot/link',
    unlinkPath: '/streamer/bots/vkvideo/bot',
    authorizeBase: VKVIDEO_AUTHORIZE_URL,
    expectsCodeChallenge: true,
    createIntegration: ({ channelId }) => createVkVideoBotIntegration({ channelId }),
  },
];

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

describe('streamer bot integrations', () => {
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
    process.env.TWITCH_CLIENT_ID = 'twitch-client-id';
    process.env.TWITCH_CLIENT_SECRET = 'twitch-client-secret';
    process.env.TWITCH_CALLBACK_URL = 'https://example.com/auth/twitch/callback';
    process.env.YOUTUBE_CLIENT_ID = 'youtube-client-id';
    process.env.YOUTUBE_CLIENT_SECRET = 'youtube-client-secret';
    process.env.YOUTUBE_CALLBACK_URL = 'https://example.com/auth/youtube/callback';
    process.env.VKVIDEO_CLIENT_ID = 'vkvideo-client-id';
    process.env.VKVIDEO_CLIENT_SECRET = 'vkvideo-client-secret';
    process.env.VKVIDEO_CALLBACK_URL = 'https://example.com/auth/vkvideo/callback';
    process.env.VKVIDEO_AUTHORIZE_URL = VKVIDEO_AUTHORIZE_URL;
  });

  it('returns default status when no per-channel override exists', async () => {
    const channel = await createChannel({ slug: 'bots-status', name: 'Bots Status' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = makeApp();

    for (const provider of PROVIDERS) {
      const res = await request(app)
        .get(provider.statusPath)
        .set('Host', 'example.com')
        .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

      expect(res.status).toBe(200);
      expect(res.body?.enabled).toBe(false);
      expect(res.body?.externalAccountId).toBeNull();
      expect(res.body?.updatedAt).toBeNull();
      expect(res.body?.lockedBySubscription).toBe(false);
    }
  });

  it('marks overrides as locked when channel is not entitled', async () => {
    const channel = await createChannel({ slug: 'bots-locked', name: 'Bots Locked' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = makeApp();

    for (const provider of PROVIDERS) {
      await provider.createIntegration({ channelId: channel.id });
      const res = await request(app)
        .get(provider.statusPath)
        .set('Host', 'example.com')
        .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

      expect(res.status).toBe(200);
      expect(res.body?.enabled).toBe(true);
      expect(typeof res.body?.externalAccountId).toBe('string');
      expect(res.body?.lockedBySubscription).toBe(true);
    }
  });

  it('shows unlocked overrides when channel is entitled', async () => {
    const channel = await createChannel({ slug: 'bots-entitled', name: 'Bots Entitled' });
    await createChannelEntitlement({ channelId: channel.id, key: 'custom_bot', enabled: true });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = makeApp();

    for (const provider of PROVIDERS) {
      await provider.createIntegration({ channelId: channel.id });
      const res = await request(app)
        .get(provider.statusPath)
        .set('Host', 'example.com')
        .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

      expect(res.status).toBe(200);
      expect(res.body?.lockedBySubscription).toBe(false);
    }
  });

  it('requires subscription to start linking bots', async () => {
    const channel = await createChannel({ slug: 'bots-link', name: 'Bots Link' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = makeApp();

    for (const provider of PROVIDERS) {
      const res = await request(app)
        .get(provider.linkPath)
        .set('Host', 'example.com')
        .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

      expect(res.status).toBe(403);
      expect(res.body?.code).toBe('SUBSCRIPTION_REQUIRED');
    }
  });

  it('redirects to OAuth when channel is entitled', async () => {
    const channel = await createChannel({ slug: 'bots-link-ok', name: 'Bots Link Ok' });
    await createChannelEntitlement({ channelId: channel.id, key: 'custom_bot', enabled: true });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = makeApp();

    for (const provider of PROVIDERS) {
      const res = await request(app)
        .get(provider.linkPath)
        .set('Host', 'example.com')
        .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

      expect(res.status).toBe(302);
      const location = String(res.headers.location || '');
      expect(location.startsWith(provider.authorizeBase)).toBe(true);
      expect(location).toContain('state=');
      if (provider.expectsCodeChallenge) {
        expect(location).toContain('code_challenge=');
      }
    }
  });

  it('unlinks bot overrides for each provider', async () => {
    const channel = await createChannel({ slug: 'bots-unlink', name: 'Bots Unlink' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = makeApp();

    for (const provider of PROVIDERS) {
      await provider.createIntegration({ channelId: channel.id });
    }

    for (const provider of PROVIDERS) {
      const res = await request(app)
        .delete(provider.unlinkPath)
        .set('Host', 'example.com')
        .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

      expect(res.status).toBe(200);
      expect(res.body?.ok).toBe(true);
    }

    const [twitch, youtube, vkvideo] = await Promise.all([
      prisma.twitchBotIntegration.findUnique({ where: { channelId: channel.id } }),
      prisma.youTubeBotIntegration.findUnique({ where: { channelId: channel.id } }),
      prisma.vkVideoBotIntegration.findUnique({ where: { channelId: channel.id } }),
    ]);

    expect(twitch).toBeNull();
    expect(youtube).toBeNull();
    expect(vkvideo).toBeNull();
  });
});
