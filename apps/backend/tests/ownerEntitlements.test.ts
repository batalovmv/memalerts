import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { prisma } from '../src/lib/prisma.js';
import { authenticate } from '../src/middleware/auth.js';
import { requireBetaAccess } from '../src/middleware/betaAccess.js';
import { ownerRoutes } from '../src/routes/owner.js';
import { createChannel, createChannelEntitlement, createUser } from './factories/index.js';

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

describe('owner entitlements', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.DOMAIN = 'example.com';
    process.env.REDIS_URL = '';
    process.env.RATE_LIMIT_WHITELIST_IPS = '';
  });

  it('returns custom bot entitlement status', async () => {
    const channel = await createChannel({ slug: 'owner-entitlements', name: 'Owner Entitlements' });
    await createChannelEntitlement({
      channelId: channel.id,
      key: 'custom_bot',
      enabled: true,
      source: 'manual',
    });
    const admin = await createUser({ role: 'admin' });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });

    const res = await request(makeApp())
      .get(`/owner/entitlements/custom-bot?channelId=${channel.id}`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(res.body?.channelId).toBe(channel.id);
    expect(res.body?.key).toBe('custom_bot');
    expect(res.body?.enabled).toBe(true);
    expect(res.body?.active).toBe(true);
    expect(res.body?.source).toBe('manual');
  });

  it('grants custom bot entitlements', async () => {
    const channel = await createChannel({ slug: 'owner-entitlements-grant', name: 'Owner Entitlements Grant' });
    const admin = await createUser({ role: 'admin' });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });

    const grantRes = await request(makeApp())
      .post('/owner/entitlements/custom-bot/grant')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ channelId: channel.id, source: 'test' });

    expect(grantRes.status).toBe(200);
    expect(grantRes.body?.ok).toBe(true);
    expect(grantRes.body?.active).toBe(true);
  });

  it('revokes custom bot entitlements', async () => {
    const channel = await createChannel({ slug: 'owner-entitlements-revoke', name: 'Owner Entitlements Revoke' });
    await createChannelEntitlement({ channelId: channel.id, key: 'custom_bot', enabled: true });
    const admin = await createUser({ role: 'admin' });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });

    const revokeRes = await request(makeApp())
      .post('/owner/entitlements/custom-bot/revoke')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ channelId: channel.id });

    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body?.ok).toBe(true);
    expect(revokeRes.body?.active).toBe(false);

    const row = await prisma.channelEntitlement.findUnique({
      where: { channelId_key: { channelId: channel.id, key: 'custom_bot' } },
      select: { enabled: true },
    });
    expect(row?.enabled).toBe(false);
  });

  it('grants custom bot entitlements by provider', async () => {
    const channel = await createChannel({
      slug: 'owner-entitlements-provider',
      name: 'Owner Entitlements Provider',
      twitchChannelId: '123456',
    });
    const admin = await createUser({ role: 'admin' });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });

    const res = await request(makeApp())
      .post('/owner/entitlements/custom-bot/grant-by-provider')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ provider: 'twitch', externalId: '123456' });

    expect(res.status).toBe(200);
    expect(res.body?.channelId).toBe(channel.id);
    expect(res.body?.granted).toBe(true);

    const row = await prisma.channelEntitlement.findUnique({
      where: { channelId_key: { channelId: channel.id, key: 'custom_bot' } },
      select: { enabled: true, source: true },
    });
    expect(row?.enabled).toBe(true);
    expect(row?.source).toBe('manual_by_provider');
  });

  it('rate limits resolve helpers', async () => {
    const admin = await createUser({ role: 'admin' });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });
    const app = makeApp();

    let lastStatus = 0;
    for (let i = 0; i < 61; i += 1) {
      const res = await request(app)
        .post('/owner/entitlements/custom-bot/grant-by-provider')
        .set('Cookie', [`token=${encodeURIComponent(token)}`])
        .send({ provider: 'twitch', externalId: 'not-a-number' });
      lastStatus = res.status;
      if (i < 60) {
        expect(res.status).toBe(400);
      }
    }

    expect(lastStatus).toBe(429);
  }, 30000);
});
