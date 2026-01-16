import { describe, expect, it, vi } from 'vitest';

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { prisma } from '../src/lib/prisma.js';
import { setupRoutes } from '../src/routes/index.js';
import { verifyJwtWithRotation } from '../src/utils/jwt.js';
import { createChannel, createUser } from './factories/index.js';

type EmitCall = { room: string; event: string; payload: unknown };
type CreditsTokenPayload = {
  kind?: string;
  v?: number;
  channelId?: string;
  channelSlug?: string;
  tv?: number;
};

function makeJwt(payload: Record<string, unknown>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
}

function makeApp(opts: { emitted?: EmitCall[]; sockets?: Array<{ data: Record<string, unknown>; disconnect: () => void }> } = {}) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const emitted = opts.emitted ?? [];
  const sockets = opts.sockets ?? [];
  app.set('io', {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          emitted.push({ room, event, payload });
        },
      };
    },
    in() {
      return {
        fetchSockets: async () => sockets,
      };
    },
  });
  setupRoutes(app);
  return app;
}

describe('streamer credits overlay', () => {
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
    process.env.TWITCH_EVENTSUB_SECRET = '';
  });

  it('returns a stable credits token with style settings', async () => {
    const channel = await createChannel({
      slug: 'credits-token',
      name: 'Credits Token',
      creditsStyleJson: '{"font":"mono"}',
      creditsTokenVersion: 2,
    });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = makeApp();

    const first = await request(app)
      .get('/streamer/credits/token')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(first.status).toBe(200);
    expect(first.body?.creditsStyleJson).toBe('{"font":"mono"}');
    const payload = verifyJwtWithRotation<CreditsTokenPayload>(first.body.token, 'credits-test');
    expect(payload.kind).toBe('credits');
    expect(payload.v).toBe(1);
    expect(payload.channelId).toBe(channel.id);
    expect(payload.channelSlug).toBe(channel.slug.toLowerCase());
    expect(payload.tv).toBe(2);

    const second = await request(app)
      .get('/streamer/credits/token')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(second.status).toBe(200);
    expect(second.body?.token).toBe(first.body.token);
  });

  it('updates credits settings and emits config', async () => {
    const channel = await createChannel({ slug: 'credits-settings', name: 'Credits Settings' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const emitted: EmitCall[] = [];
    const app = makeApp({ emitted });

    const res = await request(app)
      .post('/streamer/credits/settings')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
      .send({ creditsStyleJson: '{"theme":"dark"}' });

    expect(res.status).toBe(200);
    expect(res.body?.creditsStyleJson).toBe('{"theme":"dark"}');

    const stored = await prisma.channel.findUnique({
      where: { id: channel.id },
      select: { creditsStyleJson: true },
    });
    expect(stored?.creditsStyleJson).toBe('{"theme":"dark"}');

    const channelRoom = `channel:${channel.slug.toLowerCase()}`;
    const event = emitted.find((e) => e.room === channelRoom && e.event === 'credits:config');
    expect(event?.payload).toEqual({ creditsStyleJson: '{"theme":"dark"}' });

    const cleared = await request(app)
      .post('/streamer/credits/settings')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
      .send({ creditsStyleJson: '' });

    expect(cleared.status).toBe(200);
    expect(cleared.body?.creditsStyleJson).toBeNull();
    const clearedStored = await prisma.channel.findUnique({
      where: { id: channel.id },
      select: { creditsStyleJson: true },
    });
    expect(clearedStored?.creditsStyleJson).toBeNull();
  });

  it('rotates credits token and disconnects overlay sockets', async () => {
    const channel = await createChannel({
      slug: 'credits-rotate',
      name: 'Credits Rotate',
      creditsTokenVersion: 1,
    });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });

    const overlaySocket = { data: { isCreditsOverlay: true }, disconnect: vi.fn() };
    const normalSocket = { data: { isCreditsOverlay: false }, disconnect: vi.fn() };
    const app = makeApp({ sockets: [overlaySocket, normalSocket] });

    const before = await request(app)
      .get('/streamer/credits/token')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    const previousToken = before.body?.token as string;
    const rotated = await request(app)
      .post('/streamer/credits/token/rotate')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(rotated.status).toBe(200);
    expect(rotated.body?.token).not.toBe(previousToken);
    const payload = verifyJwtWithRotation<CreditsTokenPayload>(rotated.body.token, 'credits-rotate-test');
    expect(payload.tv).toBe(2);
    expect(overlaySocket.disconnect).toHaveBeenCalledWith(true);
    expect(normalSocket.disconnect).not.toHaveBeenCalled();
  });

  it('rejects oversized credits style payloads', async () => {
    const channel = await createChannel({ slug: 'credits-large', name: 'Credits Large' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const big = 'x'.repeat(50_001);

    const res = await request(makeApp())
      .post('/streamer/credits/settings')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
      .send({ creditsStyleJson: big });

    expect(res.status).toBe(400);
    expect(res.body?.errorCode).toBe('BAD_REQUEST');
  });
});
