import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { setupRoutes } from '../src/routes/index.js';
import {
  createChannel,
  createChannelDailyStats,
  createChannelMemeStats30d,
  createChannelUserStats30d,
  createMeme,
  createMemeActivation,
  createUser,
} from './factories/index.js';

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

describe('streamer stats', () => {
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

  it('returns channel stats with rollups and 14-day daily window', async () => {
    const channel = await createChannel({ slug: 'stats-channel', name: 'Stats Channel' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const viewerA = await createUser({ role: 'viewer' });
    const viewerB = await createUser({ role: 'viewer' });

    const memeA = await createMeme({ channelId: channel.id, title: 'Meme A', priceCoins: 120, status: 'approved' });
    const memeB = await createMeme({ channelId: channel.id, title: 'Meme B', priceCoins: 80, status: 'approved' });
    await createMeme({ channelId: channel.id, title: 'Disabled', status: 'disabled' });

    const day1 = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const day2 = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const dayOld = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);

    await createChannelDailyStats({
      channelId: channel.id,
      day: day1,
      totalActivationsCount: 3,
      totalCoinsSpentSum: BigInt(300),
    });
    await createChannelDailyStats({
      channelId: channel.id,
      day: day2,
      totalActivationsCount: 2,
      totalCoinsSpentSum: BigInt(80),
    });
    await createChannelDailyStats({
      channelId: channel.id,
      day: dayOld,
      totalActivationsCount: 1,
      totalCoinsSpentSum: BigInt(10),
    });

    await createChannelUserStats30d({
      channelId: channel.id,
      userId: viewerA.id,
      totalActivationsCount: 3,
      totalCoinsSpentSum: BigInt(300),
    });
    await createChannelUserStats30d({
      channelId: channel.id,
      userId: viewerB.id,
      totalActivationsCount: 2,
      totalCoinsSpentSum: BigInt(80),
    });

    await createChannelMemeStats30d({
      channelId: channel.id,
      channelMemeId: memeA.id,
      totalActivationsCount: 3,
      totalCoinsSpentSum: BigInt(300),
    });
    await createChannelMemeStats30d({
      channelId: channel.id,
      channelMemeId: memeB.id,
      totalActivationsCount: 2,
      totalCoinsSpentSum: BigInt(80),
    });

    await createMemeActivation({ channelId: channel.id, userId: viewerA.id, channelMemeId: memeA.id, priceCoins: 100 });
    await createMemeActivation({ channelId: channel.id, userId: viewerA.id, channelMemeId: memeA.id, priceCoins: 100 });
    await createMemeActivation({ channelId: channel.id, userId: viewerA.id, channelMemeId: memeA.id, priceCoins: 100 });
    await createMemeActivation({ channelId: channel.id, userId: viewerB.id, channelMemeId: memeB.id, priceCoins: 40 });
    await createMemeActivation({ channelId: channel.id, userId: viewerB.id, channelMemeId: memeB.id, priceCoins: 40 });

    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const res = await request(makeApp())
      .get('/streamer/stats/channel')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(res.status).toBe(200);
    expect(res.body?.overall).toEqual({
      totalActivations: 5,
      totalCoinsSpent: 380,
      totalMemes: 2,
    });

    expect(res.body?.userSpending?.[0]).toMatchObject({
      user: { id: viewerA.id, displayName: viewerA.displayName },
      totalCoinsSpent: 300,
      activationsCount: 3,
    });
    expect(res.body?.userSpending?.[1]).toMatchObject({
      user: { id: viewerB.id, displayName: viewerB.displayName },
      totalCoinsSpent: 80,
      activationsCount: 2,
    });

    expect(res.body?.memePopularity?.[0]).toMatchObject({
      meme: { id: memeA.id, title: memeA.title, priceCoins: memeA.priceCoins },
      activationsCount: 3,
      totalCoinsSpent: 300,
    });
    expect(res.body?.memePopularity?.[1]).toMatchObject({
      meme: { id: memeB.id, title: memeB.title, priceCoins: memeB.priceCoins },
      activationsCount: 2,
      totalCoinsSpent: 80,
    });

    const days = (res.body?.daily ?? []).map((d: { day?: string }) => d.day);
    expect(days).toContain(day1.toISOString());
    expect(days).toContain(day2.toISOString());
    expect(days).not.toContain(dayOld.toISOString());
    expect(res.body?.daily?.every((d: { source?: string }) => d.source === 'rollup')).toBe(true);
  });

  it('returns 304 when ETag matches', async () => {
    const channel = await createChannel({ slug: 'stats-etag', name: 'Stats Etag' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const tokenCookie = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = makeApp();

    const first = await request(app)
      .get('/streamer/stats/channel')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`]);

    expect(first.status).toBe(200);
    const etag = first.headers.etag as string;
    expect(typeof etag).toBe('string');

    const second = await request(app)
      .get('/streamer/stats/channel')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenCookie)}`])
      .set('If-None-Match', etag);

    expect(second.status).toBe(304);
  });
});
