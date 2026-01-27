import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { setupRoutes } from '../src/routes/index.js';
import { createOAuthState } from '../src/auth/oauthState.js';
import { prisma } from '../src/lib/prisma.js';
import { signJwt } from '../src/utils/jwt.js';
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

function buildAuthCookie(userId: string): string {
  const token = signJwt({ userId, role: 'viewer', channelId: null }, { expiresIn: '1h' });
  return `token=${token}`;
}

type ProviderSpec = {
  provider: 'twitch' | 'youtube' | 'vk' | 'vkvideo';
  callbackPath: string;
  kind: 'login' | 'link';
};

const linkProviders = [
  { provider: 'youtube', authorizeBase: 'https://accounts.google.com/o/oauth2/v2/auth' },
  { provider: 'vk', authorizeBase: 'https://oauth.vk.com/authorize' },
  { provider: 'vkvideo', authorizeBase: 'https://vkvideo.example.com/oauth/authorize' },
];

const callbackProviders: ProviderSpec[] = [
  { provider: 'twitch', callbackPath: '/auth/twitch/callback', kind: 'login' },
  { provider: 'youtube', callbackPath: '/auth/youtube/link/callback', kind: 'link' },
  { provider: 'vk', callbackPath: '/auth/vk/link/callback', kind: 'link' },
  { provider: 'vkvideo', callbackPath: '/auth/vkvideo/link/callback', kind: 'link' },
];

const linkCallbackProviders = [
  { provider: 'vk', providerAccountId: '123456' },
  { provider: 'vkvideo', providerAccountId: 'vkvideo-user-1' },
];

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
    process.env.REDIS_URL = '';
    process.env.AI_BULLMQ_ENABLED = '0';
    process.env.TWITCH_CLIENT_ID = 'test-twitch-client-id';
    process.env.TWITCH_CLIENT_SECRET = 'test-twitch-client-secret';
    process.env.TWITCH_CALLBACK_URL = 'https://example.com/auth/twitch/callback';
    process.env.YOUTUBE_CLIENT_ID = 'test-youtube-client-id';
    process.env.YOUTUBE_CLIENT_SECRET = 'test-youtube-client-secret';
    process.env.YOUTUBE_CALLBACK_URL = 'https://example.com/auth/youtube/link/callback';
    process.env.VK_CLIENT_ID = 'test-vk-client-id';
    process.env.VK_CLIENT_SECRET = 'test-vk-client-secret';
    process.env.VK_CALLBACK_URL = 'https://example.com/auth/vk/link/callback';
    process.env.VKVIDEO_CLIENT_ID = 'test-vkvideo-client-id';
    process.env.VKVIDEO_CLIENT_SECRET = 'test-vkvideo-client-secret';
    process.env.VKVIDEO_CALLBACK_URL = 'https://example.com/auth/vkvideo/link/callback';
    process.env.VKVIDEO_AUTHORIZE_URL = 'https://vkvideo.example.com/oauth/authorize';
    process.env.VKVIDEO_TOKEN_URL = 'https://vkvideo.example.com/oauth/token';
    process.env.VKVIDEO_USERINFO_URL = 'https://vkvideo.example.com/userinfo';
  });

  it('redirects to Twitch OAuth on login initiate', async () => {
    const res = await request(makeApp()).get('/auth/twitch').set('Host', 'example.com');
    expect(res.status).toBe(302);
    const location = String(res.headers.location || '');
    expect(location).toContain('https://id.twitch.tv/oauth2/authorize');
    expect(location).toContain('client_id=test-twitch-client-id');
  });

  it.each(['youtube', 'vk', 'vkvideo'] as const)(
    'rejects login initiation for unsupported provider %s',
    async (provider) => {
      const res = await request(makeApp()).get(`/auth/${provider}`).set('Host', 'example.com');
      expect(res.status).toBe(302);
      const location = String(res.headers.location || '');
      expect(location).toContain('error=auth_failed');
      expect(location).toContain('reason=unsupported_provider');
    }
  );

  it.each(linkProviders)('initiates %s link flow', async ({ provider, authorizeBase }) => {
    const user = await createUser({ displayName: 'Link User', role: 'viewer', hasBetaAccess: true });
    const authCookie = buildAuthCookie(user.id);
    const res = await request(makeApp())
      .get(`/auth/${provider}/link?redirect_to=/settings/accounts`)
      .set('Host', 'example.com')
      .set('Cookie', authCookie);

    expect(res.status).toBe(302);
    expect(String(res.headers.location || '')).toContain(authorizeBase);
  });

  it('handles Twitch login callback without real network calls', async () => {
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

  it('sets token_beta cookie when login comes from beta', async () => {
    process.env.DOMAIN = 'beta.example.com';
    process.env.PORT = '3002';
    const { state } = await createOAuthState({
      provider: 'twitch',
      kind: 'login',
      origin: 'https://beta.example.com',
    });

    const res = await request(makeApp())
      .get(`/auth/twitch/callback?code=test_code&state=${encodeURIComponent(state)}`)
      .set('Host', 'beta.example.com');

    expect(res.status).toBe(302);
    const cookies = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'] : [];
    expect(cookies.some((cookie: string) => cookie.startsWith('token_beta='))).toBe(true);
    expect(String(res.headers.location || '')).toContain('https://beta.example.com/');
  });

  it('handles YouTube link callback without real network calls', async () => {
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

  it.each(linkCallbackProviders)(
    'handles %s link callback without real network calls',
    async ({ provider, providerAccountId }) => {
      const user = await createUser({ displayName: 'Link User', role: 'viewer', hasBetaAccess: true });
      const { state } = await createOAuthState({
        provider,
        kind: 'link',
        userId: user.id,
        origin: 'https://example.com',
      });

      const res = await request(makeApp())
        .get(`/auth/${provider}/link/callback?code=test_code&state=${encodeURIComponent(state)}`)
        .set('Host', 'example.com');

      expect(res.status).toBe(302);
      expect(String(res.headers.location || '')).toContain('https://example.com/settings/accounts');
      const cookies = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'] : [];
      expect(cookies.some((cookie: string) => cookie.startsWith('token='))).toBe(true);

      const external = await prisma.externalAccount.findUnique({
        where: { provider_providerAccountId: { provider, providerAccountId } },
        select: { userId: true },
      });
      expect(external?.userId).toBe(user.id);
    }
  );

  it.each(callbackProviders)('rejects invalid state for %s callback', async ({ provider, callbackPath }) => {
    const res = await request(makeApp())
      .get(`${callbackPath}?code=test_code&state=missing_state`)
      .set('Host', 'example.com');

    expect(res.status).toBe(302);
    const location = String(res.headers.location || '');
    expect(location).toContain('error=auth_failed');
    expect(location).toContain('reason=state_not_found');
    if (provider === 'vkvideo') {
      expect(location).not.toContain('vk_oauth_error');
    }
  });

  it.each(callbackProviders)('rejects expired state for %s callback', async ({ provider, callbackPath, kind }) => {
    const user = kind === 'link' ? await createUser({ displayName: 'Link User', role: 'viewer' }) : null;
    const { state } = await createOAuthState({
      provider,
      kind,
      userId: user?.id,
      origin: 'https://example.com',
      ttlMs: 1,
    });
    await prisma.oAuthState.update({
      where: { state },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(makeApp())
      .get(`${callbackPath}?code=test_code&state=${encodeURIComponent(state)}`)
      .set('Host', 'example.com');

    expect(res.status).toBe(302);
    const location = String(res.headers.location || '');
    expect(location).toContain('error=auth_failed');
    expect(location).toContain('reason=state_expired');
  });

  it.each(callbackProviders)('redirects on OAuth error for %s callback', async ({ provider, callbackPath }) => {
    const res = await request(makeApp())
      .get(`${callbackPath}?error=access_denied&error_description=denied&state=missing_state`)
      .set('Host', 'example.com');

    expect(res.status).toBe(302);
    const location = String(res.headers.location || '');
    expect(location).toContain('error=auth_failed');
    if (provider === 'vkvideo') {
      expect(location).toContain('reason=vk_oauth_error');
    } else {
      expect(location).toContain('reason=access_denied');
    }
  });
});
