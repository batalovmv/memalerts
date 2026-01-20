import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import crypto from 'crypto';

import { prisma } from '../src/lib/prisma.js';
import { setupRoutes } from '../src/routes/index.js';
import { createChannel } from './factories/index.js';

type EmitCall = { room: string; event: string; payload: unknown };

function rand(): string {
  return Math.random().toString(16).slice(2);
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function makeApp(emitted: EmitCall[]) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.set('io', {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          emitted.push({ room, event, payload });
        },
      };
    },
  });
  setupRoutes(app);
  return app;
}

describe('public submissions control', () => {
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
    process.env.RATE_LIMIT_WHITELIST_IPS = '127.0.0.1,::1';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns current submissions status for a valid token', async () => {
    const token = `token_${rand()}`;
    const channel = await createChannel({
      slug: `chan_${rand()}`,
      submissionsControlTokenHash: hashToken(token),
      submissionsEnabled: false,
      submissionsOnlyWhenLive: true,
    });

    const res = await request(makeApp([]))
      .get(`/public/submissions/status?token=${encodeURIComponent(token)}`)
      .set('Host', 'example.com');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      submissions: { enabled: false, onlyWhenLive: true },
    });

    const stored = await prisma.channel.findUnique({
      where: { id: channel.id },
      select: { submissionsEnabled: true, submissionsOnlyWhenLive: true },
    });
    expect(stored?.submissionsEnabled).toBe(false);
    expect(stored?.submissionsOnlyWhenLive).toBe(true);
  });

  it('rejects invalid token with 401', async () => {
    const res = await request(makeApp([])).get('/public/submissions/status?token=bad-token').set('Host', 'example.com');

    expect(res.status).toBe(401);
    expect(res.body?.errorCode).toBe('UNAUTHORIZED');
  });

  it('enables submissions and emits status', async () => {
    const token = `token_${rand()}`;
    const channel = await createChannel({
      slug: `chan_${rand()}`,
      submissionsControlTokenHash: hashToken(token),
      submissionsEnabled: false,
      submissionsOnlyWhenLive: true,
    });
    const emitted: EmitCall[] = [];

    const res = await request(makeApp(emitted))
      .post(`/public/submissions/enable?token=${encodeURIComponent(token)}`)
      .set('Host', 'example.com');

    expect(res.status).toBe(200);
    expect(res.body?.submissions?.enabled).toBe(true);
    expect(res.body?.submissions?.onlyWhenLive).toBe(true);

    const stored = await prisma.channel.findUnique({
      where: { id: channel.id },
      select: { submissionsEnabled: true, submissionsOnlyWhenLive: true },
    });
    expect(stored?.submissionsEnabled).toBe(true);
    expect(stored?.submissionsOnlyWhenLive).toBe(true);

    const channelRoom = `channel:${channel.slug.toLowerCase()}`;
    expect(emitted.some((e) => e.room === channelRoom && e.event === 'submissions:status')).toBe(true);
    const payload = emitted.find((e) => e.room === channelRoom && e.event === 'submissions:status')?.payload as {
      enabled?: boolean;
      onlyWhenLive?: boolean;
    };
    expect(payload).toEqual({ enabled: true, onlyWhenLive: true });
  });

  it('disables submissions and emits status', async () => {
    const token = `token_${rand()}`;
    const channel = await createChannel({
      slug: `chan_${rand()}`,
      submissionsControlTokenHash: hashToken(token),
      submissionsEnabled: true,
      submissionsOnlyWhenLive: false,
    });
    const emitted: EmitCall[] = [];

    const res = await request(makeApp(emitted))
      .post(`/public/submissions/disable?token=${encodeURIComponent(token)}`)
      .set('Host', 'example.com');

    expect(res.status).toBe(200);
    expect(res.body?.submissions?.enabled).toBe(false);
    expect(res.body?.submissions?.onlyWhenLive).toBe(false);

    const stored = await prisma.channel.findUnique({
      where: { id: channel.id },
      select: { submissionsEnabled: true, submissionsOnlyWhenLive: true },
    });
    expect(stored?.submissionsEnabled).toBe(false);
    expect(stored?.submissionsOnlyWhenLive).toBe(false);

    const channelRoom = `channel:${channel.slug.toLowerCase()}`;
    expect(emitted.some((e) => e.room === channelRoom && e.event === 'submissions:status')).toBe(true);
  });

  it('toggles submissions and emits status', async () => {
    const token = `token_${rand()}`;
    const channel = await createChannel({
      slug: `chan_${rand()}`,
      submissionsControlTokenHash: hashToken(token),
      submissionsEnabled: true,
      submissionsOnlyWhenLive: true,
    });
    const emitted: EmitCall[] = [];

    const res = await request(makeApp(emitted))
      .post(`/public/submissions/toggle?token=${encodeURIComponent(token)}`)
      .set('Host', 'example.com');

    expect(res.status).toBe(200);
    expect(res.body?.submissions?.enabled).toBe(false);
    expect(res.body?.submissions?.onlyWhenLive).toBe(true);

    const stored = await prisma.channel.findUnique({
      where: { id: channel.id },
      select: { submissionsEnabled: true, submissionsOnlyWhenLive: true },
    });
    expect(stored?.submissionsEnabled).toBe(false);
    expect(stored?.submissionsOnlyWhenLive).toBe(true);

    const channelRoom = `channel:${channel.slug.toLowerCase()}`;
    expect(emitted.some((e) => e.room === channelRoom && e.event === 'submissions:status')).toBe(true);
  });
});
