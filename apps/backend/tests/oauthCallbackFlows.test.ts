import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { setupRoutes } from '../src/routes/index.js';
import { createOAuthState } from '../src/auth/oauthState.js';
import { prisma } from '../src/lib/prisma.js';
import { createUser } from './factories/index.js';
import { resetMockHandlers, startMockServer, stopMockServer } from './mocks/server.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.set('io', { to: () => ({ emit: () => {} }) });
  setupRoutes(app);
  return app;
}

describe('OAuth callback flows (mocked external services)', () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    startMockServer({ onUnhandledRequest: 'error' });
  });

  afterEach(() => {
    resetMockHandlers();
  });

  afterAll(() => {
    stopMockServer();
    process.env = originalEnv;
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.DOMAIN = 'example.com';
    process.env.WEB_URL = 'https://example.com';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  });

  it('handles Twitch login callback without real network calls', async () => {
    process.env.TWITCH_CLIENT_ID = 'test-twitch-client-id';
    process.env.TWITCH_CLIENT_SECRET = 'test-twitch-client-secret';
    process.env.TWITCH_CALLBACK_URL = 'https://example.com/auth/twitch/callback';

    const { state } = await createOAuthState({
      provider: 'twitch',
      kind: 'login',
      origin: 'https://example.com',
    });

    const res = await request(makeApp())
      .get(`/auth/twitch/callback?code=test_code&state=${encodeURIComponent(state)}`)
      .set('Host', 'example.com');

    expect(res.status).toBe(302);
    expect(String(res.headers.location || '')).toContain('https://example.com/');
    const cookies = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'] : [];
    expect(cookies.some((cookie: string) => cookie.startsWith('token='))).toBe(true);

    const user = await prisma.user.findFirst({
      where: { twitchUserId: '123456789' },
      select: { id: true },
    });
    expect(user).not.toBeNull();

    const external = await prisma.externalAccount.findUnique({
      where: { provider_providerAccountId: { provider: 'twitch', providerAccountId: '123456789' } },
      select: { id: true, userId: true },
    });
    expect(external?.userId).toBe(user?.id);
  });

  it('handles YouTube link callback without real network calls', async () => {
    process.env.YOUTUBE_CLIENT_ID = 'test-youtube-client-id';
    process.env.YOUTUBE_CLIENT_SECRET = 'test-youtube-client-secret';
    process.env.YOUTUBE_CALLBACK_URL = 'https://example.com/auth/youtube/link/callback';

    const user = await createUser({ displayName: 'Link User', role: 'viewer', hasBetaAccess: true });
    const { state } = await createOAuthState({
      provider: 'youtube',
      kind: 'link',
      userId: user.id,
      origin: 'https://example.com',
    });

    const res = await request(makeApp())
      .get(`/auth/youtube/link/callback?code=test_code&state=${encodeURIComponent(state)}`)
      .set('Host', 'example.com');

    expect(res.status).toBe(302);
    expect(String(res.headers.location || '')).toContain('https://example.com/settings/accounts');
    const cookies = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'] : [];
    expect(cookies.some((cookie: string) => cookie.startsWith('token='))).toBe(true);

    const external = await prisma.externalAccount.findUnique({
      where: { provider_providerAccountId: { provider: 'youtube', providerAccountId: 'youtube_user_123' } },
      select: { userId: true, login: true, profileUrl: true, displayName: true },
    });

    expect(external?.userId).toBe(user.id);
    expect(external?.login).toBe('yt_channel_123');
    expect(external?.profileUrl).toBe('https://www.youtube.com/channel/yt_channel_123');
    expect(external?.displayName).toBe('My YouTube Channel');
  });
});
