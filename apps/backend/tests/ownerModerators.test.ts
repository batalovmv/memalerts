import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { prisma } from '../src/lib/prisma.js';
import { authenticate } from '../src/middleware/auth.js';
import { requireBetaAccess } from '../src/middleware/betaAccess.js';
import { ownerRoutes } from '../src/routes/owner.js';
import { createGlobalModerator, createUser } from './factories/index.js';

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

describe('owner global moderators', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.DOMAIN = 'example.com';
  });

  it('lists global moderators with active flag', async () => {
    const admin = await createUser({ role: 'admin' });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });
    const active = await createGlobalModerator();
    const revoked = await createGlobalModerator({ revokedAt: new Date(), revokedByUserId: admin.id });

    const res = await request(makeApp())
      .get('/owner/moderators')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    const byUser = new Map(res.body.map((row: { userId: string; active: boolean }) => [row.userId, row.active]));
    expect(byUser.get(active.userId)).toBe(true);
    expect(byUser.get(revoked.userId)).toBe(false);
  });

  it('grants global moderator access', async () => {
    const admin = await createUser({ role: 'admin' });
    const target = await createUser({ role: 'viewer' });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });

    const res = await request(makeApp())
      .post(`/owner/moderators/${target.id}/grant`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(res.body?.userId).toBe(target.id);
    expect(res.body?.revokedAt).toBeNull();

    const row = await prisma.globalModerator.findUnique({
      where: { userId: target.id },
      select: { revokedAt: true, grantedByUserId: true },
    });
    expect(row?.revokedAt).toBeNull();
    expect(row?.grantedByUserId).toBe(admin.id);
  });

  it('revokes global moderator access', async () => {
    const admin = await createUser({ role: 'admin' });
    const target = await createUser({ role: 'viewer' });
    await createGlobalModerator({ userId: target.id, revokedAt: null, revokedByUserId: null });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });

    const res = await request(makeApp())
      .post(`/owner/moderators/${target.id}/revoke`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(res.body?.userId).toBe(target.id);
    expect(res.body?.revokedAt).not.toBeNull();

    const row = await prisma.globalModerator.findUnique({
      where: { userId: target.id },
      select: { revokedAt: true, revokedByUserId: true },
    });
    expect(row?.revokedAt).not.toBeNull();
    expect(row?.revokedByUserId).toBe(admin.id);
  });
});
