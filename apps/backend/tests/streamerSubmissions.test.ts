import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { setupRoutes } from '../src/routes/index.js';
import { createChannel, createSubmission, createUser } from './factories/index.js';

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

describe('streamer submissions list', () => {
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

  it('lists submissions for the streamer channel with status filter and pagination', async () => {
    const channel = await createChannel({ slug: 'streamer-channel', name: 'Streamer Channel' });
    const otherChannel = await createChannel({ slug: 'other-channel', name: 'Other Channel' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });

    const t1 = new Date('2024-01-01T00:00:00.000Z');
    const t2 = new Date('2024-01-02T00:00:00.000Z');
    const t3 = new Date('2024-01-03T00:00:00.000Z');

    const pendingOld = await createSubmission({
      channelId: channel.id,
      submitterUserId: streamer.id,
      title: 'Pending Old',
      status: 'pending',
      createdAt: t1,
    });
    const pendingNew = await createSubmission({
      channelId: channel.id,
      submitterUserId: streamer.id,
      title: 'Pending New',
      status: 'pending',
      createdAt: t2,
    });
    await createSubmission({
      channelId: channel.id,
      submitterUserId: streamer.id,
      title: 'Approved',
      status: 'approved',
      createdAt: t3,
    });
    await createSubmission({
      channelId: otherChannel.id,
      submitterUserId: streamer.id,
      title: 'Other Channel',
      status: 'pending',
    });

    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const first = await request(makeApp())
      .get('/streamer/submissions?status=pending&limit=1')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(first.status).toBe(200);
    expect(first.body?.items).toHaveLength(1);
    expect(first.body.items[0].id).toBe(pendingNew.id);
    expect(typeof first.body?.nextCursor).toBe('string');

    const next = await request(makeApp())
      .get(`/streamer/submissions?status=pending&cursor=${encodeURIComponent(first.body.nextCursor)}`)
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(next.status).toBe(200);
    expect(next.body?.items).toHaveLength(1);
    expect(next.body.items[0].id).toBe(pendingOld.id);
    expect(next.body.items[0].channelId).toBe(channel.id);
    expect(next.body?.nextCursor).toBeNull();
  });

  it('blocks non-streamer roles', async () => {
    const viewer = await createUser({ role: 'viewer', channelId: null });
    const token = makeJwt({ userId: viewer.id, role: viewer.role, channelId: null });

    const res = await request(makeApp())
      .get('/streamer/submissions')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(403);
    expect(res.body?.errorCode).toBe('ROLE_REQUIRED');
  });
});
