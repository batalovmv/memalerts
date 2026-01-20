import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { setupRoutes } from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { prisma } from '../src/lib/prisma.js';
import { createChannel, createPromotion, createUser } from './factories/index.js';

function makeJwt(payload: Record<string, unknown>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.set('io', { to: () => ({ emit: () => {} }) });
  setupRoutes(app);
  app.use(errorHandler);
  return app;
}

describe('streamer promotions', () => {
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

  it('lists promotions for the streamer channel only', async () => {
    const channel = await createChannel({ slug: 'promo-channel', name: 'Promo Channel' });
    const otherChannel = await createChannel({ slug: 'promo-other', name: 'Promo Other' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });

    const older = await createPromotion({
      channelId: channel.id,
      name: 'Older',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    });
    const newer = await createPromotion({
      channelId: channel.id,
      name: 'Newer',
      createdAt: new Date('2024-02-01T00:00:00.000Z'),
    });
    await createPromotion({
      channelId: otherChannel.id,
      name: 'Other',
      createdAt: new Date('2024-03-01T00:00:00.000Z'),
    });

    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const res = await request(makeApp())
      .get('/streamer/promotions')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(res.status).toBe(200);
    expect(res.body?.length).toBe(2);
    expect(res.body[0].id).toBe(newer.id);
    expect(res.body[1].id).toBe(older.id);
  });

  it('creates promotions and validates date ordering', async () => {
    const channel = await createChannel({ slug: 'promo-create', name: 'Promo Create' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });

    const startDate = '2024-01-01T00:00:00.000Z';
    const endDate = '2024-02-01T00:00:00.000Z';
    const res = await request(makeApp())
      .post('/streamer/promotions')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
      .send({
        name: 'Launch promo',
        discountPercent: 25,
        startDate,
        endDate,
      });

    expect(res.status).toBe(201);
    expect(res.body?.name).toBe('Launch promo');
    expect(res.body?.discountPercent).toBe(25);
    expect(res.body?.channelId).toBe(channel.id);

    const invalid = await request(makeApp())
      .post('/streamer/promotions')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
      .send({
        name: 'Invalid promo',
        discountPercent: 10,
        startDate: endDate,
        endDate: startDate,
      });

    expect(invalid.status).toBe(400);
    expect(invalid.body?.errorCode).toBe('BAD_REQUEST');
  });

  it('updates promotions and enforces channel ownership', async () => {
    const channel = await createChannel({ slug: 'promo-update', name: 'Promo Update' });
    const otherChannel = await createChannel({ slug: 'promo-update-other', name: 'Promo Update Other' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });

    const promo = await createPromotion({
      channelId: channel.id,
      name: 'Initial',
      discountPercent: 10,
      isActive: true,
    });
    const otherPromo = await createPromotion({ channelId: otherChannel.id });

    const res = await request(makeApp())
      .patch(`/streamer/promotions/${promo.id}`)
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
      .send({ discountPercent: 30, isActive: false });

    expect(res.status).toBe(200);
    expect(res.body?.discountPercent).toBe(30);
    expect(res.body?.isActive).toBe(false);

    const invalidDates = await request(makeApp())
      .patch(`/streamer/promotions/${promo.id}`)
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
      .send({
        startDate: '2024-02-01T00:00:00.000Z',
        endDate: '2024-01-01T00:00:00.000Z',
      });

    expect(invalidDates.status).toBe(400);
    expect(invalidDates.body?.errorCode).toBe('BAD_REQUEST');

    const forbidden = await request(makeApp())
      .patch(`/streamer/promotions/${otherPromo.id}`)
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
      .send({ discountPercent: 15 });

    expect(forbidden.status).toBe(404);
    expect(forbidden.body?.errorCode).toBe('NOT_FOUND');
  });

  it('deletes promotions for the streamer channel only', async () => {
    const channel = await createChannel({ slug: 'promo-delete', name: 'Promo Delete' });
    const otherChannel = await createChannel({ slug: 'promo-delete-other', name: 'Promo Delete Other' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });

    const promo = await createPromotion({ channelId: channel.id });
    const otherPromo = await createPromotion({ channelId: otherChannel.id });

    const res = await request(makeApp())
      .delete(`/streamer/promotions/${promo.id}`)
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);

    const stored = await prisma.promotion.findUnique({ where: { id: promo.id } });
    expect(stored).toBeNull();

    const forbidden = await request(makeApp())
      .delete(`/streamer/promotions/${otherPromo.id}`)
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(forbidden.status).toBe(404);
    expect(forbidden.body?.errorCode).toBe('NOT_FOUND');
  });
});
