import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { prisma } from '../src/lib/prisma.js';
import { authenticate } from '../src/middleware/auth.js';
import { requireBetaAccess } from '../src/middleware/betaAccess.js';
import { ownerRoutes } from '../src/routes/owner.js';
import { createMemeAsset, createUser } from './factories/index.js';
import { uniqueId } from './factories/utils.js';

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
    const hiddenReason = `test-${uniqueId('hidden')}`;
    const hidden = await createMemeAsset({
      poolVisibility: 'hidden',
      poolHiddenAt: new Date(),
      poolHiddenByUserId: admin.id,
      poolHiddenReason: hiddenReason,
    });
    await createMemeAsset({ poolVisibility: 'visible' });

    const res = await request(makeApp())
      .get(`/owner/meme-assets?status=hidden&limit=20&offset=0&q=${encodeURIComponent(hiddenReason)}`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(res.headers['x-total']).toBe('1');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(hidden.id);
    expect(res.body[0].hiddenReason).toBe(hiddenReason);
  });

  it('hides and unhides meme assets', async () => {
    const admin = await createUser({ role: 'admin' });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });
    const asset = await createMemeAsset({ poolVisibility: 'visible' });

    const hideRes = await request(makeApp())
      .post(`/owner/meme-assets/${asset.id}/hide`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ reason: 'bad' });

    expect(hideRes.status).toBe(200);
    expect(hideRes.body?.poolVisibility).toBe('hidden');
    expect(hideRes.body?.hiddenReason).toBe('bad');

    const unhideRes = await request(makeApp())
      .post(`/owner/meme-assets/${asset.id}/unhide`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(unhideRes.status).toBe(200);
    expect(unhideRes.body?.poolVisibility).toBe('visible');
    expect(unhideRes.body?.hiddenReason).toBeNull();
  });

  it('purges and restores meme assets', async () => {
    const admin = await createUser({ role: 'admin' });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });
    const asset = await createMemeAsset({ poolVisibility: 'visible' });

    const purgeRes = await request(makeApp())
      .post(`/owner/meme-assets/${asset.id}/purge`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ reason: 'dmca', days: 2 });

    expect(purgeRes.status).toBe(200);
    expect(purgeRes.body?.poolVisibility).toBe('hidden');
    expect(purgeRes.body?.purgeReason).toBe('dmca');
    expect(purgeRes.body?.purgeNotBefore).not.toBeNull();

    const restored = await request(makeApp())
      .post(`/owner/meme-assets/${asset.id}/restore`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(restored.status).toBe(200);
    expect(restored.body?.poolVisibility).toBe('visible');
    expect(restored.body?.purgeReason).toBeNull();

    const row = await prisma.memeAsset.findUnique({
      where: { id: asset.id },
      select: { purgeRequestedAt: true, purgedAt: true, purgeReason: true },
    });
    expect(row?.purgeRequestedAt).toBeNull();
    expect(row?.purgedAt).toBeNull();
    expect(row?.purgeReason).toBeNull();
  });
});
