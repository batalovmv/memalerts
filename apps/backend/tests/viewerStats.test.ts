import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { setupRoutes } from '../src/routes/index.js';
import { createChannel, createMeme, createMemeActivation } from './factories/index.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.set('io', { to: () => ({ emit: () => {} }) });
  setupRoutes(app);
  return app;
}

describe('viewer meme stats', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.PORT = '3001';
    process.env.DOMAIN = 'example.com';
    process.env.REDIS_URL = '';
    process.env.AI_BULLMQ_ENABLED = '0';
    process.env.CHAT_OUTBOX_BULLMQ_ENABLED = '0';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns top memes by activations', async () => {
    const channel = await createChannel({ slug: 'stats-channel', name: 'Stats Channel' });
    const topMeme = await createMeme({ channelId: channel.id, title: 'Top Meme', priceCoins: 100 });
    const secondMeme = await createMeme({ channelId: channel.id, title: 'Second Meme', priceCoins: 50 });

    await createMemeActivation({ channelId: channel.id, memeId: topMeme.id, coinsSpent: 100 });
    await createMemeActivation({ channelId: channel.id, memeId: topMeme.id, coinsSpent: 100 });
    await createMemeActivation({ channelId: channel.id, memeId: topMeme.id, coinsSpent: 100 });
    await createMemeActivation({ channelId: channel.id, memeId: secondMeme.id, coinsSpent: 50 });

    const res = await request(makeApp())
      .get(`/memes/stats?channelId=${encodeURIComponent(channel.id)}&period=all&limit=2`)
      .set('Host', 'example.com');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.stats)).toBe(true);
    expect(res.body.stats).toHaveLength(2);
    expect(res.body.stats[0].meme?.id).toBe(topMeme.id);
    expect(res.body.stats[0].activationsCount).toBe(3);
    expect(res.body.stats[0].totalCoinsSpent).toBe(300);
    expect(res.body.stats[1].meme?.id).toBe(secondMeme.id);
    expect(res.body.stats[1].activationsCount).toBe(1);
  });

  it('returns empty stats and supports ETag caching', async () => {
    const channel = await createChannel({ slug: 'stats-empty', name: 'Stats Empty' });

    const first = await request(makeApp())
      .get(`/memes/stats?channelSlug=${encodeURIComponent(channel.slug)}&period=all&limit=5`)
      .set('Host', 'example.com');

    expect(first.status).toBe(200);
    expect(Array.isArray(first.body?.stats)).toBe(true);
    expect(first.body.stats).toHaveLength(0);
    expect(typeof first.headers?.etag).toBe('string');

    const cached = await request(makeApp())
      .get(`/memes/stats?channelSlug=${encodeURIComponent(channel.slug)}&period=all&limit=5`)
      .set('Host', 'example.com')
      .set('If-None-Match', first.headers.etag as string);

    expect(cached.status).toBe(304);
  });
});
