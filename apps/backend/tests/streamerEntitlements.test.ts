import { describe, expect, it } from 'vitest';

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { setupRoutes } from '../src/routes/index.js';
import { createChannel, createChannelEntitlement, createUser } from './factories/index.js';

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

describe('streamer entitlements', () => {
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

  it('returns false when no entitlement exists', async () => {
    const channel = await createChannel({ slug: 'entitlements-none', name: 'Entitlements None' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = makeApp();

    const res = await request(app)
      .get('/streamer/entitlements/custom-bot')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(res.status).toBe(200);
    expect(res.body?.entitled).toBe(false);
  });

  it('returns true when entitlement is active', async () => {
    const channel = await createChannel({ slug: 'entitlements-on', name: 'Entitlements On' });
    await createChannelEntitlement({ channelId: channel.id, enabled: true });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = makeApp();

    const res = await request(app)
      .get('/streamer/entitlements/custom-bot')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(res.status).toBe(200);
    expect(res.body?.entitled).toBe(true);
  });

  it('returns false when entitlement is expired', async () => {
    const channel = await createChannel({ slug: 'entitlements-expired', name: 'Entitlements Expired' });
    await createChannelEntitlement({
      channelId: channel.id,
      enabled: true,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = makeApp();

    const res = await request(app)
      .get('/streamer/entitlements/custom-bot')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(res.status).toBe(200);
    expect(res.body?.entitled).toBe(false);
  });

  it('returns 400 when channelId is missing', async () => {
    const streamer = await createUser({ role: 'streamer', channelId: null });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: null });
    const app = makeApp();

    const res = await request(app)
      .get('/streamer/entitlements/custom-bot')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(res.status).toBe(400);
    expect(res.body?.message).toBe('Missing channelId');
  });
});
