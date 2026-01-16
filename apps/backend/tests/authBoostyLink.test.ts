import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { http, HttpResponse } from 'msw';

import { setupRoutes } from '../src/routes/index.js';
import { prisma } from '../src/lib/prisma.js';
import { signJwt } from '../src/utils/jwt.js';
import { createUser } from './factories/index.js';
import { mockServer, resetMockHandlers, startMockServer, stopMockServer } from './mocks/server.js';

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

function mockBoostyUserId(userId: string) {
  mockServer.use(http.get('https://api.boosty.to/v1/user', () => HttpResponse.json({ id: userId })));
}

describe('auth boosty link', () => {
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
    process.env.BOOSTY_REWARDS_MODE = 'boosty_api';
    process.env.BOOSTY_API_BASE_URL = 'https://api.boosty.to';
  });

  it('links a boosty account with a valid access token', async () => {
    const user = await createUser({ role: 'viewer', hasBetaAccess: true });
    mockBoostyUserId(`boosty-user-${user.id}`);

    const res = await request(makeApp())
      .post('/auth/boosty/link')
      .set('Host', 'example.com')
      .set('Cookie', buildAuthCookie(user.id))
      .send({ accessToken: 'boosty-token', blogName: 'myblog' });

    expect(res.status).toBe(200);
    expect((res.body as { ok?: boolean })?.ok).toBe(true);

    const account = await prisma.externalAccount.findFirst({
      where: { userId: user.id, provider: 'boosty' },
      select: { accessToken: true, login: true, profileUrl: true },
    });
    expect(account?.accessToken).toBe('boosty-token');
    expect(account?.login).toBe('myblog');
    expect(account?.profileUrl).toBe('https://boosty.to/myblog');
  });

  it('rejects invalid access tokens', async () => {
    mockServer.use(
      http.get('https://api.boosty.to/v1/user/subscriptions', () => new HttpResponse(null, { status: 401 }))
    );

    const user = await createUser({ role: 'viewer', hasBetaAccess: true });

    const res = await request(makeApp())
      .post('/auth/boosty/link')
      .set('Host', 'example.com')
      .set('Cookie', buildAuthCookie(user.id))
      .send({ accessToken: 'bad-token' });

    expect(res.status).toBe(401);
    expect((res.body as { errorCode?: string })?.errorCode).toBe('BOOSTY_INVALID_TOKEN');

    const account = await prisma.externalAccount.findFirst({ where: { userId: user.id, provider: 'boosty' } });
    expect(account).toBeNull();
  });

  it('updates the linked account when linking again', async () => {
    const user = await createUser({ role: 'viewer', hasBetaAccess: true });
    const boostyUserId = `boosty-user-${user.id}`;
    mockBoostyUserId(boostyUserId);

    const first = await request(makeApp())
      .post('/auth/boosty/link')
      .set('Host', 'example.com')
      .set('Cookie', buildAuthCookie(user.id))
      .send({ accessToken: 'boosty-token-a' });

    expect(first.status).toBe(200);

    const second = await request(makeApp())
      .post('/auth/boosty/link')
      .set('Host', 'example.com')
      .set('Cookie', buildAuthCookie(user.id))
      .send({ accessToken: 'boosty-token-b' });

    expect(second.status).toBe(200);

    const account = await prisma.externalAccount.findFirst({
      where: { userId: user.id, provider: 'boosty' },
      select: { accessToken: true },
    });
    expect(account?.accessToken).toBe('boosty-token-b');
  });
});
