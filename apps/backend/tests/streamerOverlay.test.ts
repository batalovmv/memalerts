import { beforeEach, describe, expect, it, vi } from 'vitest';

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { setupRoutes } from '../src/routes/index.js';
import { verifyJwtWithRotation } from '../src/utils/jwt.js';
import { createChannel, createUser } from './factories/index.js';

type OverlayTokenPayload = {
  kind?: string;
  v?: number;
  channelId?: string;
  channelSlug?: string;
  tv?: number;
};

function makeJwt(payload: Record<string, unknown>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
}

function makeApp(ioOverride?: {
  to?: () => { emit: () => void };
  in?: () => { fetchSockets: () => Promise<unknown[]> };
}) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const io = ioOverride ?? {
    to: () => ({ emit: () => {} }),
    in: () => ({ fetchSockets: async () => [] }),
  };
  app.set('io', io);
  setupRoutes(app);
  return app;
}

describe('streamer overlay settings', () => {
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

  it('returns a stable overlay token with channel settings', async () => {
    const channel = await createChannel({
      slug: 'OverlaySlug',
      name: 'Overlay Channel',
      overlayMode: 'simultaneous',
      overlayShowSender: true,
      overlayMaxConcurrent: 4,
      overlayStyleJson: '{"theme":"retro"}',
      overlayTokenVersion: 3,
    });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });

    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = makeApp();

    const first = await request(app)
      .get('/streamer/overlay/token')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(first.status).toBe(200);
    expect(first.body?.overlayMode).toBe('simultaneous');
    expect(first.body?.overlayShowSender).toBe(true);
    expect(first.body?.overlayMaxConcurrent).toBe(4);
    expect(first.body?.overlayStyleJson).toBe('{"theme":"retro"}');
    expect(typeof first.body?.token).toBe('string');

    const payload = verifyJwtWithRotation<OverlayTokenPayload>(first.body.token, 'overlay-test');
    expect(payload.kind).toBe('overlay');
    expect(payload.v).toBe(1);
    expect(payload.channelId).toBe(channel.id);
    expect(payload.channelSlug).toBe(channel.slug.toLowerCase());
    expect(payload.tv).toBe(3);

    const second = await request(app)
      .get('/streamer/overlay/token')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(second.status).toBe(200);
    expect(second.body?.token).toBe(first.body.token);
  });

  it('rotates the overlay token and disconnects overlay sockets', async () => {
    const channel = await createChannel({
      slug: 'overlay-rotate',
      name: 'Overlay Rotate',
      overlayMode: 'queue',
      overlayShowSender: false,
      overlayMaxConcurrent: 3,
      overlayTokenVersion: 1,
    });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });

    const overlaySocket = { data: { isOverlay: true }, disconnect: vi.fn() };
    const normalSocket = { data: { isOverlay: false }, disconnect: vi.fn() };
    const io = {
      to: () => ({ emit: () => {} }),
      in: () => ({ fetchSockets: async () => [overlaySocket, normalSocket] }),
    };

    const app = makeApp(io);
    const before = await request(app)
      .get('/streamer/overlay/token')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(before.status).toBe(200);
    const previousToken = before.body?.token as string;

    const rotated = await request(app)
      .post('/streamer/overlay/token/rotate')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(rotated.status).toBe(200);
    expect(rotated.body?.token).not.toBe(previousToken);
    expect(rotated.body?.overlayMode).toBe('queue');
    expect(rotated.body?.overlayShowSender).toBe(false);
    expect(rotated.body?.overlayMaxConcurrent).toBe(3);

    const payload = verifyJwtWithRotation<OverlayTokenPayload>(rotated.body.token, 'overlay-rotate-test');
    expect(payload.tv).toBe(2);

    expect(overlaySocket.disconnect).toHaveBeenCalledWith(true);
    expect(normalSocket.disconnect).not.toHaveBeenCalled();
  });
});
