import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { prisma } from '../src/lib/prisma.js';
import { setupRoutes } from '../src/routes/index.js';
import { createChannel, createUser } from './factories/index.js';

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

describe('streamer overlay presets', () => {
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

  it('lists stored presets', async () => {
    const initialPresets = [
      {
        id: 'preset-1',
        name: 'Default',
        createdAt: 123,
        payload: { v: 1, overlayMode: 'queue', overlayShowSender: true, overlayMaxConcurrent: 3 },
      },
    ];

    const channel = await createChannel({
      slug: 'overlay-presets',
      name: 'Overlay Presets',
      overlayPresetsJson: JSON.stringify(initialPresets),
    });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });

    const res = await request(makeApp())
      .get('/streamer/overlay/presets')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(res.status).toBe(200);
    expect(res.body?.presets).toEqual(initialPresets);
  });

  it('updates presets list (create/update/delete semantics)', async () => {
    const channel = await createChannel({ slug: 'overlay-presets-update', name: 'Overlay Presets Update' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });

    const nextPresets = [
      {
        id: 'preset-2',
        name: 'Scene 2',
        createdAt: 456,
        payload: { v: 1, overlayMode: 'simultaneous', overlayShowSender: false, overlayMaxConcurrent: 2 },
      },
    ];

    const putRes = await request(makeApp())
      .put('/streamer/overlay/presets')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
      .send({ presets: nextPresets });

    expect(putRes.status).toBe(200);
    expect(putRes.body?.ok).toBe(true);

    const stored = await prisma.channel.findUnique({
      where: { id: channel.id },
      select: { overlayPresetsJson: true },
    });
    expect(JSON.parse(stored?.overlayPresetsJson ?? '[]')).toEqual(nextPresets);

    const clearRes = await request(makeApp())
      .put('/streamer/overlay/presets')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
      .send({ presets: [] });

    expect(clearRes.status).toBe(200);
    const cleared = await prisma.channel.findUnique({
      where: { id: channel.id },
      select: { overlayPresetsJson: true },
    });
    expect(cleared?.overlayPresetsJson).toBeNull();
  });

  it('validates overlay presets payloads', async () => {
    const channel = await createChannel({ slug: 'overlay-presets-invalid', name: 'Overlay Presets Invalid' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });

    const res = await request(makeApp())
      .put('/streamer/overlay/presets')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
      .send({
        presets: [
          {
            id: 'x',
            name: '',
            createdAt: -1,
            payload: { v: 1 },
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body?.errorCode).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body?.details)).toBe(true);
  });

  it('rejects oversized overlay presets payloads', async () => {
    const channel = await createChannel({ slug: 'overlay-presets-large', name: 'Overlay Presets Large' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const bigText = 'x'.repeat(76_000);

    const res = await request(makeApp())
      .put('/streamer/overlay/presets')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
      .send({
        presets: [
          {
            id: 'preset-big',
            name: 'Big preset',
            createdAt: 1,
            payload: { v: 1, style: { blob: bigText } },
          },
        ],
      });

    expect(res.status).toBe(413);
    expect(res.body?.errorCode).toBe('FILE_TOO_LARGE');
  });
});
