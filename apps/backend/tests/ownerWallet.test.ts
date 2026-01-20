import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { prisma } from '../src/lib/prisma.js';
import { authenticate } from '../src/middleware/auth.js';
import { requireBetaAccess } from '../src/middleware/betaAccess.js';
import { ownerRoutes } from '../src/routes/owner.js';
import { createChannel, createUser, createWallet } from './factories/index.js';

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

describe('owner wallet management', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.DOMAIN = 'example.com';
    process.env.ADMIN_WALLETS_PAGE_MAX = '100';
  });

  it('returns wallet options for dropdowns', async () => {
    const channel = await createChannel({ slug: 'wallets-options', name: 'Wallets Options' });
    const user = await createUser({ displayName: 'Wallet User' });
    await createWallet({ userId: user.id, channelId: channel.id, balance: 100 });
    const admin = await createUser({ role: 'admin' });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });

    const res = await request(makeApp())
      .get('/owner/wallets/options')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.users)).toBe(true);
    expect(Array.isArray(res.body?.channels)).toBe(true);
    expect(res.body.users.some((u: { id: string }) => u.id === user.id)).toBe(true);
    expect(res.body.channels.some((c: { id: string }) => c.id === channel.id)).toBe(true);
  });

  it('paginates wallets and returns totals', async () => {
    const channel = await createChannel({ slug: 'wallets-a', name: 'Wallets A' });
    const otherChannel = await createChannel({ slug: 'wallets-b', name: 'Wallets B' });
    const userA = await createUser({ displayName: 'User A' });
    const userB = await createUser({ displayName: 'User B' });
    const userC = await createUser({ displayName: 'User C' });
    await createWallet({ userId: userA.id, channelId: channel.id, balance: 10 });
    await createWallet({ userId: userB.id, channelId: channel.id, balance: 20 });
    await createWallet({ userId: userC.id, channelId: otherChannel.id, balance: 30 });

    const admin = await createUser({ role: 'admin' });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });

    const res = await request(makeApp())
      .get(`/owner/wallets?channelId=${channel.id}&limit=1&offset=0&includeTotal=1`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.items)).toBe(true);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(2);
  });

  it('adjusts wallet balances and logs audit entries', async () => {
    const channel = await createChannel({ slug: 'wallets-adjust', name: 'Wallets Adjust' });
    const user = await createUser({ displayName: 'Wallet Adjust User' });
    await createWallet({ userId: user.id, channelId: channel.id, balance: 100 });

    const admin = await createUser({ role: 'admin' });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });

    const res = await request(makeApp())
      .post(`/owner/wallets/${user.id}/${channel.id}/adjust`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ amount: 50 });

    expect(res.status).toBe(200);
    expect(res.body?.balance).toBe(150);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'wallet_adjust', actorId: admin.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(String(audit?.payloadJson || '')).toContain('"amount":50');
  });

  it('requires admin access', async () => {
    const viewer = await createUser({ role: 'viewer' });
    const token = makeJwt({ userId: viewer.id, role: viewer.role, channelId: null });

    const res = await request(makeApp())
      .get('/owner/wallets')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(403);
  });
});
