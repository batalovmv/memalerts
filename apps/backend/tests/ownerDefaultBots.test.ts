import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { prisma } from '../src/lib/prisma.js';
import { authenticate } from '../src/middleware/auth.js';
import { requireBetaAccess } from '../src/middleware/betaAccess.js';
import { ownerRoutes } from '../src/routes/owner.js';
import {
  createGlobalKickBotCredential,
  createGlobalTrovoBotCredential,
  createGlobalTwitchBotCredential,
  createGlobalVkVideoBotCredential,
  createGlobalYouTubeBotCredential,
  createUser,
} from './factories/index.js';

type ProviderConfig = {
  key: 'twitch' | 'youtube' | 'vkvideo' | 'trovo' | 'kick';
  statusPath: string;
  linkPath: string;
  unlinkPath: string;
  authorizeBase: string;
  expectsCodeChallenge?: boolean;
  createCredential: () => Promise<{ externalAccountId: string }>;
  countCredentials: () => Promise<number>;
};

const PROVIDERS: ProviderConfig[] = [
  {
    key: 'twitch',
    statusPath: '/owner/bots/twitch/default/status',
    linkPath: '/owner/bots/twitch/default/link',
    unlinkPath: '/owner/bots/twitch/default',
    authorizeBase: 'https://id.twitch.tv/oauth2/authorize',
    createCredential: createGlobalTwitchBotCredential,
    countCredentials: () => prisma.globalTwitchBotCredential.count(),
  },
  {
    key: 'youtube',
    statusPath: '/owner/bots/youtube/default/status',
    linkPath: '/owner/bots/youtube/default/link',
    unlinkPath: '/owner/bots/youtube/default',
    authorizeBase: 'https://accounts.google.com/o/oauth2/v2/auth',
    createCredential: createGlobalYouTubeBotCredential,
    countCredentials: () => prisma.globalYouTubeBotCredential.count(),
  },
  {
    key: 'vkvideo',
    statusPath: '/owner/bots/vkvideo/default/status',
    linkPath: '/owner/bots/vkvideo/default/link',
    unlinkPath: '/owner/bots/vkvideo/default',
    authorizeBase: 'https://vkvideo.example/oauth/authorize',
    expectsCodeChallenge: true,
    createCredential: createGlobalVkVideoBotCredential,
    countCredentials: () => prisma.globalVkVideoBotCredential.count(),
  },
  {
    key: 'trovo',
    statusPath: '/owner/bots/trovo/default/status',
    linkPath: '/owner/bots/trovo/default/link',
    unlinkPath: '/owner/bots/trovo/default',
    authorizeBase: 'https://open.trovo.live/page/login.html',
    createCredential: createGlobalTrovoBotCredential,
    countCredentials: () => prisma.globalTrovoBotCredential.count(),
  },
  {
    key: 'kick',
    statusPath: '/owner/bots/kick/default/status',
    linkPath: '/owner/bots/kick/default/link',
    unlinkPath: '/owner/bots/kick/default',
    authorizeBase: 'https://kick.example/oauth/authorize',
    createCredential: createGlobalKickBotCredential,
    countCredentials: () => prisma.globalKickBotCredential.count(),
  },
];

function makeJwt(payload: Record<string, unknown>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/owner', authenticate, requireBetaAccess, ownerRoutes);
  return app;
}

describe('owner default bots', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.DOMAIN = 'example.com';

    process.env.TWITCH_CLIENT_ID = 'twitch-client-id';
    process.env.TWITCH_CLIENT_SECRET = 'twitch-client-secret';
    process.env.TWITCH_CALLBACK_URL = 'https://example.com/auth/twitch/callback';

    process.env.YOUTUBE_CLIENT_ID = 'youtube-client-id';
    process.env.YOUTUBE_CLIENT_SECRET = 'youtube-client-secret';
    process.env.YOUTUBE_CALLBACK_URL = 'https://example.com/auth/youtube/callback';

    process.env.VKVIDEO_CLIENT_ID = 'vkvideo-client-id';
    process.env.VKVIDEO_CLIENT_SECRET = 'vkvideo-client-secret';
    process.env.VKVIDEO_CALLBACK_URL = 'https://example.com/auth/vkvideo/callback';
    process.env.VKVIDEO_AUTHORIZE_URL = 'https://vkvideo.example/oauth/authorize';
    process.env.VKVIDEO_TOKEN_URL = 'https://vkvideo.example/oauth/token';
    process.env.VKVIDEO_BOT_SCOPES = 'chat';

    process.env.TROVO_CLIENT_ID = 'trovo-client-id';
    process.env.TROVO_CLIENT_SECRET = 'trovo-client-secret';
    process.env.TROVO_CALLBACK_URL = 'https://example.com/auth/trovo/callback';
    process.env.TROVO_BOT_SCOPES = 'chat';

    process.env.KICK_CLIENT_ID = 'kick-client-id';
    process.env.KICK_CLIENT_SECRET = 'kick-client-secret';
    process.env.KICK_CALLBACK_URL = 'https://example.com/auth/kick/callback';
    process.env.KICK_AUTHORIZE_URL = 'https://kick.example/oauth/authorize';
    process.env.KICK_TOKEN_URL = 'https://kick.example/oauth/token';
    process.env.KICK_REFRESH_URL = 'https://kick.example/oauth/refresh';
    process.env.KICK_USERINFO_URL = 'https://kick.example/oauth/userinfo';
    process.env.KICK_BOT_SCOPES = 'chat';

    await Promise.all([
      prisma.globalTwitchBotCredential.deleteMany({}),
      prisma.globalYouTubeBotCredential.deleteMany({}),
      prisma.globalVkVideoBotCredential.deleteMany({}),
      prisma.globalTrovoBotCredential.deleteMany({}),
      prisma.globalKickBotCredential.deleteMany({}),
    ]);
  });

  it('returns default status when no credentials exist', async () => {
    const admin = await createUser({ role: 'admin' });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });
    const app = makeApp();

    for (const provider of PROVIDERS) {
      const res = await request(app)
        .get(provider.statusPath)
        .set('Cookie', [`token=${encodeURIComponent(token)}`]);

      expect(res.status).toBe(200);
      expect(res.body?.enabled).toBe(false);
      expect(res.body?.externalAccountId).toBeNull();
      expect(res.body?.updatedAt).toBeNull();
    }
  });

  it('returns status when credentials exist', async () => {
    const admin = await createUser({ role: 'admin' });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });
    const app = makeApp();

    for (const provider of PROVIDERS) {
      const row = await provider.createCredential();
      const res = await request(app)
        .get(provider.statusPath)
        .set('Cookie', [`token=${encodeURIComponent(token)}`]);

      expect(res.status).toBe(200);
      expect(res.body?.enabled).toBe(true);
      expect(res.body?.externalAccountId).toBe(row.externalAccountId);
      expect(typeof res.body?.updatedAt).toBe('string');
    }
  });

  it('redirects to OAuth link flow for each provider', async () => {
    const admin = await createUser({ role: 'admin' });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });
    const app = makeApp();

    for (const provider of PROVIDERS) {
      const res = await request(app)
        .get(provider.linkPath)
        .set('Cookie', [`token=${encodeURIComponent(token)}`]);

      expect(res.status).toBe(302);
      const location = String(res.headers.location || '');
      expect(location.startsWith(provider.authorizeBase)).toBe(true);
      expect(location).toContain('state=');
      if (provider.expectsCodeChallenge) {
        expect(location).toContain('code_challenge=');
      }
    }
  });

  it('unlinks default bot credentials', async () => {
    const admin = await createUser({ role: 'admin' });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });
    const app = makeApp();

    for (const provider of PROVIDERS) {
      await provider.createCredential();
      const res = await request(app)
        .delete(provider.unlinkPath)
        .set('Cookie', [`token=${encodeURIComponent(token)}`]);

      expect(res.status).toBe(200);
      expect(res.body?.ok).toBe(true);
      expect(await provider.countCredentials()).toBe(0);
    }
  });

  it('requires admin access', async () => {
    const viewer = await createUser({ role: 'viewer' });
    const token = makeJwt({ userId: viewer.id, role: viewer.role, channelId: null });
    const res = await request(makeApp())
      .get('/owner/bots/twitch/default/status')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(403);
  });
});
