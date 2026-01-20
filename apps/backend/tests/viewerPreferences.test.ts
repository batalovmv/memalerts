import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { setupRoutes } from '../src/routes/index.js';
import { createUser } from './factories/index.js';

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

describe('viewer preferences', () => {
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

  it('returns defaults when preferences are not stored yet', async () => {
    const user = await createUser({ role: 'viewer', hasBetaAccess: false, channelId: null });
    const token = makeJwt({ userId: user.id, role: user.role, channelId: null });

    const res = await request(makeApp())
      .get('/me/preferences')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      theme: 'light',
      autoplayMemesEnabled: true,
      memeModalMuted: false,
      coinsInfoSeen: false,
    });
  });

  it('updates preferences and supports partial updates', async () => {
    const user = await createUser({ role: 'viewer', hasBetaAccess: false, channelId: null });
    const token = makeJwt({ userId: user.id, role: user.role, channelId: null });

    const first = await request(makeApp())
      .patch('/me/preferences')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ theme: 'dark' });

    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      theme: 'dark',
      autoplayMemesEnabled: true,
      memeModalMuted: false,
      coinsInfoSeen: false,
    });

    const second = await request(makeApp())
      .patch('/me/preferences')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ memeModalMuted: true });

    expect(second.status).toBe(200);
    expect(second.body).toEqual({
      theme: 'dark',
      autoplayMemesEnabled: true,
      memeModalMuted: true,
      coinsInfoSeen: false,
    });

    const getRes = await request(makeApp())
      .get('/me/preferences')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(getRes.status).toBe(200);
    expect(getRes.body).toEqual({
      theme: 'dark',
      autoplayMemesEnabled: true,
      memeModalMuted: true,
      coinsInfoSeen: false,
    });
  });

  it('validates PATCH input', async () => {
    const user = await createUser({ role: 'viewer', hasBetaAccess: false, channelId: null });
    const token = makeJwt({ userId: user.id, role: user.role, channelId: null });

    const empty = await request(makeApp())
      .patch('/me/preferences')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({});

    expect(empty.status).toBe(400);
    expect(empty.body?.error).toBe('Invalid input');

    const invalid = await request(makeApp())
      .patch('/me/preferences')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ theme: 'blue' });

    expect(invalid.status).toBe(400);
    expect(invalid.body?.error).toBe('Invalid input');
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(makeApp()).get('/me/preferences').set('Host', 'example.com');

    expect(res.status).toBe(401);
    expect(res.body?.error).toBe('Unauthorized');
  });
});
