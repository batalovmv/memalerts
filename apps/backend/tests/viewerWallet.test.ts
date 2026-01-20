import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { prisma } from '../src/lib/prisma.js';
import { setupRoutes } from '../src/routes/index.js';
import { createChannel, createUser, createWallet } from './factories/index.js';

function makeJwt(payload: Record<string, unknown>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.set('io', { to: () => ({ emit: () => {} }) });
  setupRoutes(app);
  return app;
}

describe('viewer wallet endpoints', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.PORT = '3001';
    process.env.DOMAIN = 'example.com';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.REDIS_URL = '';
    process.env.AI_BULLMQ_ENABLED = '0';
    process.env.CHAT_OUTBOX_BULLMQ_ENABLED = '0';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('rejects /wallet without channelId', async () => {
    const user = await createUser({ role: 'viewer', hasBetaAccess: false, channelId: null });
    const token = makeJwt({ userId: user.id, role: user.role, channelId: null });

    const res = await request(makeApp())
      .get('/wallet')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(400);
    expect(res.body?.error).toBe('Channel ID is required');
  });

  it('returns existing wallet for channelId', async () => {
    const user = await createUser({ role: 'viewer', hasBetaAccess: false, channelId: null });
    const channel = await createChannel({ slug: 'wallet-channel', name: 'Wallet Channel' });
    const wallet = await createWallet({ userId: user.id, channelId: channel.id, balance: 321 });

    const token = makeJwt({ userId: user.id, role: user.role, channelId: null });
    const res = await request(makeApp())
      .get(`/wallet?channelId=${encodeURIComponent(channel.id)}`)
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(res.body?.id).toBe(wallet.id);
    expect(res.body?.userId).toBe(user.id);
    expect(res.body?.channelId).toBe(channel.id);
    expect(res.body?.balance).toBe(321);
  });

  it('returns a default wallet when none exists', async () => {
    const user = await createUser({ role: 'viewer', hasBetaAccess: false, channelId: null });
    const channel = await createChannel({ slug: 'wallet-default', name: 'Wallet Default' });

    const token = makeJwt({ userId: user.id, role: user.role, channelId: null });
    const res = await request(makeApp())
      .get(`/wallet?channelId=${encodeURIComponent(channel.id)}`)
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(res.body?.id).toBe('');
    expect(res.body?.userId).toBe(user.id);
    expect(res.body?.channelId).toBe(channel.id);
    expect(res.body?.balance).toBe(0);
  });

  it('creates wallet on /channels/:slug/wallet when missing', async () => {
    const user = await createUser({ role: 'viewer', hasBetaAccess: false, channelId: null });
    const channel = await createChannel({ slug: 'wallet-slug', name: 'Wallet Slug' });

    const token = makeJwt({ userId: user.id, role: user.role, channelId: null });
    const res = await request(makeApp())
      .get(`/channels/${channel.slug}/wallet`)
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(typeof res.body?.id).toBe('string');
    expect(res.body?.id).not.toBe('');
    expect(res.body?.userId).toBe(user.id);
    expect(res.body?.channelId).toBe(channel.id);
    expect(res.body?.balance).toBe(0);

    const stored = await prisma.wallet.findUnique({
      where: { userId_channelId: { userId: user.id, channelId: channel.id } },
      select: { id: true },
    });
    expect(stored?.id).toBe(res.body?.id);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(makeApp()).get('/wallet').set('Host', 'example.com');

    expect(res.status).toBe(401);
    expect(res.body?.errorCode).toBe('UNAUTHORIZED');
  });
});
