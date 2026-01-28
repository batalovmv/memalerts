import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

import { prisma } from '../src/lib/prisma.js';
import { setupRoutes } from '../src/routes/index.js';
import { createChannel, createMeme, createPromotion, createUser, createWallet } from './factories/index.js';

type EmitCall = { room: string; event: string; payload: unknown };

function makeJwt(payload: Record<string, unknown>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
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

describe('viewer activation flow', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.PORT = '3001';
    process.env.DOMAIN = 'example.com';
    process.env.REDIS_URL = '';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.RATE_LIMIT_WHITELIST_IPS = '127.0.0.1,::1';
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
    })) as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('activates a meme, applies promo pricing, and emits socket events', async () => {
    const channel = await createChannel({
      slug: 'Activation-Channel',
      name: 'Activation Channel',
      defaultPriceCoins: 200,
    });
    const viewer = await createUser({ role: 'viewer', hasBetaAccess: false, channelId: null });
    await createWallet({ userId: viewer.id, channelId: channel.id, balance: 500 });
    const meme = await createMeme({
      channelId: channel.id,
      priceCoins: 200,
      status: 'approved',
    });
    await createPromotion({ channelId: channel.id, discountPercent: 50 });

    const emitted: EmitCall[] = [];
    const app = makeApp(emitted);
    const token = makeJwt({ userId: viewer.id, role: 'viewer', channelId: null });

    const res = await request(app)
      .post(`/memes/${meme.id}/activate`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .set('Host', 'example.com')
      .send({});

    expect(res.status).toBe(200);
    expect(['queued', 'playing']).toContain(res.body?.activation?.status);
    expect(res.body?.originalPrice).toBe(200);
    expect(res.body?.finalPrice).toBe(100);
    expect(res.body?.discountApplied).toBe(50);

    const wallet = await prisma.wallet.findUnique({
      where: { userId_channelId: { userId: viewer.id, channelId: channel.id } },
      select: { balance: true },
    });
    expect(wallet?.balance).toBe(420);

    const activation = await prisma.memeActivation.findUnique({
      where: { id: res.body?.activation?.id },
    });
    expect(['queued', 'playing']).toContain(activation?.status);
    expect(activation?.priceCoins).toBe(100);

    const channelRoom = `channel:${channel.slug.toLowerCase()}`;
    const userRoom = `user:${viewer.id}`;
    expect(emitted.some((e) => e.room === channelRoom && e.event === 'activation:new')).toBe(true);
    expect(emitted.some((e) => e.room === userRoom && e.event === 'wallet:updated')).toBe(true);
    expect(emitted.some((e) => e.room.startsWith('channel:') && e.event === 'wallet:updated')).toBe(false);
  });

  it('rejects activation when balance is insufficient', async () => {
    const channel = await createChannel();
    const viewer = await createUser({ role: 'viewer', hasBetaAccess: false, channelId: null });
    await createWallet({ userId: viewer.id, channelId: channel.id, balance: 10 });
    const meme = await createMeme({ channelId: channel.id, priceCoins: 50, status: 'approved' });

    const emitted: EmitCall[] = [];
    const app = makeApp(emitted);
    const token = makeJwt({ userId: viewer.id, role: 'viewer', channelId: null });

    const res = await request(app)
      .post(`/memes/${meme.id}/activate`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .set('Host', 'example.com')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body?.error).toContain('Insufficient balance');
    expect(emitted).toHaveLength(0);
  });

  it('rejects unapproved or deleted memes', async () => {
    const channel = await createChannel();
    const viewer = await createUser({ role: 'viewer', hasBetaAccess: false, channelId: null });
    await createWallet({ userId: viewer.id, channelId: channel.id, balance: 100 });
    const meme = await createMeme({ channelId: channel.id, priceCoins: 50, status: 'pending' });

    const emitted: EmitCall[] = [];
    const app = makeApp(emitted);
    const token = makeJwt({ userId: viewer.id, role: 'viewer', channelId: null });

    const res = await request(app)
      .post(`/memes/${meme.id}/activate`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .set('Host', 'example.com')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body?.error).toContain('Meme is not approved');
    expect(emitted).toHaveLength(0);
  });

  it('returns 404 for missing memes', async () => {
    const viewer = await createUser({ role: 'viewer', hasBetaAccess: false, channelId: null });
    const token = makeJwt({ userId: viewer.id, role: 'viewer', channelId: null });

    const emitted: EmitCall[] = [];
    const app = makeApp(emitted);

    const res = await request(app)
      .post(`/memes/${randomUUID()}/activate`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .set('Host', 'example.com')
      .send({});

    expect(res.status).toBe(404);
    expect(res.body?.error).toContain('Meme not found');
    expect(emitted).toHaveLength(0);
  });

  it('charges per activation even with duplicate idempotency keys', async () => {
    const channel = await createChannel();
    const viewer = await createUser({ role: 'viewer', hasBetaAccess: false, channelId: null });
    await createWallet({ userId: viewer.id, channelId: channel.id, balance: 300 });
    const meme = await createMeme({ channelId: channel.id, priceCoins: 100, status: 'approved' });

    const emitted: EmitCall[] = [];
    const app = makeApp(emitted);
    const token = makeJwt({ userId: viewer.id, role: 'viewer', channelId: null });

    const first = await request(app)
      .post(`/memes/${meme.id}/activate`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .set('Idempotency-Key', 'activation-1')
      .set('Host', 'example.com')
      .send({});
    const second = await request(app)
      .post(`/memes/${meme.id}/activate`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .set('Idempotency-Key', 'activation-1')
      .set('Host', 'example.com')
      .send({});

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const wallet = await prisma.wallet.findUnique({
      where: { userId_channelId: { userId: viewer.id, channelId: channel.id } },
      select: { balance: true },
    });
    expect(wallet?.balance).toBe(120);

    const activations = await prisma.memeActivation.findMany({
      where: { userId: viewer.id, channelId: channel.id, channelMemeId: meme.id },
    });
    expect(activations).toHaveLength(2);

    const activationEvents = emitted.filter((e) => e.event === 'activation:new');
    const walletEvents = emitted.filter((e) => e.event === 'wallet:updated');
    expect(activationEvents).toHaveLength(2);
    expect(walletEvents.length).toBeGreaterThanOrEqual(2);
  });
});
