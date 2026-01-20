import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { http, HttpResponse } from 'msw';

import { setupRoutes } from '../src/routes/index.js';
import { prisma } from '../src/lib/prisma.js';
import { signJwt } from '../src/utils/jwt.js';
import { createOAuthState } from '../src/auth/oauthState.js';
import { createExternalAccount, createUser } from './factories/index.js';
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

describe('auth account linking', () => {
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
    process.env.DISCORD_CLIENT_ID = 'test-discord-client-id';
    process.env.DISCORD_CLIENT_SECRET = 'test-discord-client-secret';
    process.env.DISCORD_CALLBACK_URL = 'https://example.com/auth/discord/link/callback';
    process.env.DISCORD_AUTO_JOIN_GUILD = '0';
  });

  it('lists linked accounts for the authenticated user', async () => {
    const user = await createUser({ role: 'viewer', hasBetaAccess: true });
    const other = await createUser({ role: 'viewer', hasBetaAccess: true });

    const account1 = await createExternalAccount({
      userId: user.id,
      provider: 'twitch',
      providerAccountId: `twitch_${randomUUID()}`,
    });
    const account2 = await createExternalAccount({
      userId: user.id,
      provider: 'discord',
      providerAccountId: `discord_${randomUUID()}`,
    });
    await createExternalAccount({
      userId: other.id,
      provider: 'twitch',
      providerAccountId: `twitch_${randomUUID()}`,
    });

    const res = await request(makeApp())
      .get('/auth/accounts')
      .set('Host', 'example.com')
      .set('Cookie', buildAuthCookie(user.id));

    expect(res.status).toBe(200);
    const ids = (res.body as { accounts?: Array<{ id?: string }> })?.accounts?.map((a) => a.id).sort();
    expect(ids).toEqual([account1.id, account2.id].sort());
  });

  it('prevents unlinking the last account', async () => {
    const user = await createUser({ role: 'viewer', hasBetaAccess: true });
    const account = await createExternalAccount({
      userId: user.id,
      provider: 'twitch',
      providerAccountId: `twitch_${randomUUID()}`,
    });

    const res = await request(makeApp())
      .delete(`/auth/accounts/${account.id}`)
      .set('Host', 'example.com')
      .set('Cookie', buildAuthCookie(user.id));

    expect(res.status).toBe(400);
    expect((res.body as { error?: string })?.error).toBe('Cannot unlink last account');
  });

  it('unlinks an account when multiple are present', async () => {
    const user = await createUser({ role: 'viewer', hasBetaAccess: true });
    const account1 = await createExternalAccount({
      userId: user.id,
      provider: 'twitch',
      providerAccountId: `twitch_${randomUUID()}`,
    });
    const account2 = await createExternalAccount({
      userId: user.id,
      provider: 'discord',
      providerAccountId: `discord_${randomUUID()}`,
    });

    const res = await request(makeApp())
      .delete(`/auth/accounts/${account1.id}`)
      .set('Host', 'example.com')
      .set('Cookie', buildAuthCookie(user.id));

    expect(res.status).toBe(200);
    expect((res.body as { ok?: boolean })?.ok).toBe(true);

    const remaining = await prisma.externalAccount.findMany({
      where: { userId: user.id },
      select: { id: true },
    });
    expect(remaining.map((r) => r.id)).toEqual([account2.id]);
  });

  it('updates tokens when linking an already linked provider', async () => {
    const user = await createUser({ role: 'viewer', hasBetaAccess: true });
    const providerAccountId = `discord_${randomUUID()}`;

    await prisma.externalAccount.create({
      data: {
        userId: user.id,
        provider: 'discord',
        providerAccountId,
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
      },
    });

    mockServer.use(
      http.post('https://discord.com/api/oauth2/token', () =>
        HttpResponse.json({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
          scope: 'identify',
        })
      ),
      http.get('https://discord.com/api/users/@me', () =>
        HttpResponse.json({
          id: providerAccountId,
          username: 'OverrideUser',
          global_name: 'Override User',
          discriminator: '0001',
          avatar: 'overridehash',
        })
      )
    );

    const { state } = await createOAuthState({
      provider: 'discord',
      kind: 'link',
      userId: user.id,
      origin: 'https://example.com',
    });

    const res = await request(makeApp())
      .get(`/auth/discord/link/callback?code=test_code&state=${encodeURIComponent(state)}`)
      .set('Host', 'example.com');

    expect(res.status).toBe(302);
    expect(String(res.headers.location || '')).toContain('https://example.com/settings/accounts');

    const updated = await prisma.externalAccount.findUnique({
      where: { provider_providerAccountId: { provider: 'discord', providerAccountId } },
      select: { accessToken: true, refreshToken: true },
    });
    expect(updated?.accessToken).toBe('new-access');
    expect(updated?.refreshToken).toBe('new-refresh');
  });

  it('rejects linking when provider account belongs to another user', async () => {
    const userA = await createUser({ role: 'viewer', hasBetaAccess: true });
    const userB = await createUser({ role: 'viewer', hasBetaAccess: true });
    const providerAccountId = `discord_${randomUUID()}`;

    await prisma.externalAccount.create({
      data: {
        userId: userA.id,
        provider: 'discord',
        providerAccountId,
      },
    });

    mockServer.use(
      http.post('https://discord.com/api/oauth2/token', () =>
        HttpResponse.json({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
          scope: 'identify',
        })
      ),
      http.get('https://discord.com/api/users/@me', () =>
        HttpResponse.json({
          id: providerAccountId,
          username: 'ConflictUser',
          global_name: 'Conflict User',
          discriminator: '0001',
          avatar: 'conflicthash',
        })
      )
    );

    const { state } = await createOAuthState({
      provider: 'discord',
      kind: 'link',
      userId: userB.id,
      origin: 'https://example.com',
    });

    const res = await request(makeApp())
      .get(`/auth/discord/link/callback?code=test_code&state=${encodeURIComponent(state)}`)
      .set('Host', 'example.com');

    expect(res.status).toBe(302);
    const location = String(res.headers.location || '');
    expect(location).toContain('error=auth_failed');
    expect(location).toContain('reason=account_already_linked');
  });
});
