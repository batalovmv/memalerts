import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { authenticate } from '../src/middleware/auth.js';
import { requireBetaAccess } from '../src/middleware/betaAccess.js';
import { ownerRoutes } from '../src/routes/owner.js';
import { createChannel, createUser } from './factories/index.js';

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

describe('owner channel resolve', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.DOMAIN = 'example.com';
    process.env.REDIS_URL = '';
    process.env.RATE_LIMIT_WHITELIST_IPS = '';
  });

  it('resolves twitch channel by external id', async () => {
    const channel = await createChannel({
      slug: 'resolve-channel',
      name: 'Resolve Channel',
      twitchChannelId: '123456',
    });
    const admin = await createUser({ role: 'admin' });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });

    const res = await request(makeApp())
      .get('/owner/channels/resolve?provider=twitch&externalId=123456')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(res.body?.channelId).toBe(channel.id);
    expect(res.body?.provider).toBe('twitch');
    expect(res.body?.externalId).toBe('123456');
    expect(res.body?.displayHint?.twitchChannelId).toBe('123456');
  });

  it('returns not found when channel is missing', async () => {
    const admin = await createUser({ role: 'admin' });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });

    const res = await request(makeApp())
      .get('/owner/channels/resolve?provider=twitch&externalId=999999')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(404);
    expect(res.body?.error).toBe('NOT_FOUND');
  });

  it('rejects unsupported providers', async () => {
    const admin = await createUser({ role: 'admin' });
    const token = makeJwt({ userId: admin.id, role: admin.role, channelId: null });

    const res = await request(makeApp())
      .get('/owner/channels/resolve?provider=youtube&externalId=123')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(400);
    expect(res.body?.message).toBe('Unsupported provider');
  });
});
