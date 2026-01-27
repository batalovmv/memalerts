import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { prisma } from '../src/lib/prisma.js';
import { authenticate } from '../src/middleware/auth.js';
import { requireBetaAccess } from '../src/middleware/betaAccess.js';
import { ownerRoutes } from '../src/routes/owner.js';
import { createMemeAsset, createUser } from './factories/index.js';

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

describe('owner meme asset moderation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.DOMAIN = 'example.com';
    process.env.REDIS_URL = '';
  });

  it('lists hidden meme assets with pagination headers', async () => {
    const admin = await createUser({ role: 'admin' });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });
    const hidden = await createMemeAsset({
      status: 'hidden',
      hiddenAt: new Date(),
    });
    await createMemeAsset({ status: 'active' });

    const res = await request(makeApp())
      .get(`/owner/meme-assets?status=hidden&limit=20&offset=0`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(res.headers['x-total']).toBeDefined();
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((a: { id: string }) => a.id === hidden.id)).toBe(true);
  });

  it('hides and unhides meme assets', async () => {
    const admin = await createUser({ role: 'admin' });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });
    const asset = await createMemeAsset({ status: 'active' });

    const hideRes = await request(makeApp())
      .post(`/owner/meme-assets/${asset.id}/hide`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ reason: 'bad' });

    expect(hideRes.status).toBe(200);
    expect(hideRes.body?.poolVisibility).toBe('hidden');
    expect(hideRes.body?.status).toBe('hidden');

    const unhideRes = await request(makeApp())
      .post(`/owner/meme-assets/${asset.id}/unhide`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(unhideRes.status).toBe(200);
    expect(unhideRes.body?.poolVisibility).toBe('visible');
    expect(unhideRes.body?.status).toBe('active');
  });

  it('purges and restores meme assets', async () => {
    const admin = await createUser({ role: 'admin' });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });
    const asset = await createMemeAsset({ status: 'active' });

    const purgeRes = await request(makeApp())
      .post(`/owner/meme-assets/${asset.id}/purge`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ reason: 'dmca', days: 2 });

    expect(purgeRes.status).toBe(200);
    expect(purgeRes.body?.poolVisibility).toBe('hidden');
    expect(purgeRes.body?.status).toBe('deleted');

    const restored = await request(makeApp())
      .post(`/owner/meme-assets/${asset.id}/restore`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(restored.status).toBe(200);
    expect(restored.body?.poolVisibility).toBe('visible');
    expect(restored.body?.status).toBe('active');

    const row = await prisma.memeAsset.findUnique({
      where: { id: asset.id },
      select: { status: true, deletedAt: true, hiddenAt: true, quarantinedAt: true },
    });
    expect(row?.status).toBe('active');
    expect(row?.deletedAt).toBeNull();
    expect(row?.hiddenAt).toBeNull();
  });
});
