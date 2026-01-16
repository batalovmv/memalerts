import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Prisma } from '@prisma/client';

import { setupRoutes } from '../src/routes/index.js';
import { createChannel, createChannelMeme, createMemeAsset, createUser } from './factories/index.js';

function rand(): string {
  return Math.random().toString(16).slice(2);
}

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

describe('viewer memes list and search', () => {
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

  it('lists channel memes for /memes with limit/offset', async () => {
    const channel = await createChannel({ slug: `memes_${rand()}`, name: 'Memes Channel' });
    const viewer = await createUser({ role: 'viewer', hasBetaAccess: false, channelId: null });
    const creator = await createUser({ displayName: 'Creator', role: 'viewer', channelId: null });

    const t1 = new Date('2024-01-01T00:00:00.000Z');
    const t2 = new Date('2024-01-02T00:00:00.000Z');

    const asset1 = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/old.webm',
      durationMs: 1000,
      createdByUserId: creator.id,
    } satisfies Prisma.MemeAssetUncheckedCreateInput);
    const asset2 = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/new.webm',
      durationMs: 1000,
      createdByUserId: creator.id,
    } satisfies Prisma.MemeAssetUncheckedCreateInput);

    const older = await createChannelMeme({
      channelId: channel.id,
      memeAssetId: asset1.id,
      title: 'Older',
      priceCoins: 100,
      createdAt: t1,
    });
    await createChannelMeme({
      channelId: channel.id,
      memeAssetId: asset2.id,
      title: 'Newer',
      priceCoins: 120,
      createdAt: t2,
    });

    const token = makeJwt({ userId: viewer.id, role: viewer.role, channelId: null });
    const res = await request(makeApp())
      .get(`/memes?channelSlug=${encodeURIComponent(channel.slug)}&limit=1&offset=1`)
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].channelMemeId).toBe(older.id);
    expect(res.body[0].createdBy).toEqual({ id: creator.id, displayName: creator.displayName });
  });

  it('paginates and sorts /channels/:slug/memes with cursor and ETag', async () => {
    const channel = await createChannel({ slug: `public_${rand()}`, name: 'Public Channel' });
    const creator = await createUser({ displayName: 'Creator', role: 'viewer', channelId: null });

    const asset1 = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/cheap.webm',
      durationMs: 1000,
      createdByUserId: creator.id,
    } satisfies Prisma.MemeAssetUncheckedCreateInput);
    const asset2 = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/mid.webm',
      durationMs: 1000,
      createdByUserId: creator.id,
    } satisfies Prisma.MemeAssetUncheckedCreateInput);
    const asset3 = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/expensive.webm',
      durationMs: 1000,
      createdByUserId: creator.id,
    } satisfies Prisma.MemeAssetUncheckedCreateInput);

    await createChannelMeme({ channelId: channel.id, memeAssetId: asset1.id, title: 'Cheap', priceCoins: 10 });
    await createChannelMeme({ channelId: channel.id, memeAssetId: asset2.id, title: 'Mid', priceCoins: 20 });
    await createChannelMeme({ channelId: channel.id, memeAssetId: asset3.id, title: 'Expensive', priceCoins: 30 });

    const first = await request(makeApp())
      .get(`/channels/${channel.slug}/memes?limit=2&sortBy=priceCoins&sortOrder=asc`)
      .set('Host', 'example.com');

    expect(first.status).toBe(200);
    expect(first.body?.items).toHaveLength(2);
    expect(first.body.items[0].priceCoins).toBeLessThanOrEqual(first.body.items[1].priceCoins);
    expect(typeof first.body?.nextCursor).toBe('string');
    expect(typeof first.headers?.etag).toBe('string');

    const etag = first.headers.etag as string;
    const cached = await request(makeApp())
      .get(`/channels/${channel.slug}/memes?limit=2&sortBy=priceCoins&sortOrder=asc`)
      .set('Host', 'example.com')
      .set('If-None-Match', etag);
    expect(cached.status).toBe(304);

    const next = await request(makeApp())
      .get(`/channels/${channel.slug}/memes?cursor=${encodeURIComponent(first.body.nextCursor)}&sortBy=priceCoins&sortOrder=asc`)
      .set('Host', 'example.com');

    expect(next.status).toBe(200);
    expect(next.body?.items).toHaveLength(1);
    expect(next.body?.nextCursor).toBeNull();
  });

  it('searches channel memes by query', async () => {
    const channel = await createChannel({ slug: `search_${rand()}`, name: 'Search Channel' });
    const assetCat = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/cat.webm',
      durationMs: 1000,
    });
    const assetDog = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/dog.webm',
      durationMs: 1000,
    });

    await createChannelMeme({ channelId: channel.id, memeAssetId: assetCat.id, title: 'Cat meme', priceCoins: 50 });
    await createChannelMeme({ channelId: channel.id, memeAssetId: assetDog.id, title: 'Dog meme', priceCoins: 50 });

    const res = await request(makeApp())
      .get(`/channels/memes/search?q=cat&channelSlug=${encodeURIComponent(channel.slug)}`)
      .set('Host', 'example.com');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title.toLowerCase()).toContain('cat');
  });

  it('returns pool_all assets for /channels/:slug/memes', async () => {
    const channel = await createChannel({
      slug: `pool_${rand()}`,
      name: 'Pool Channel',
      memeCatalogMode: 'pool_all',
      defaultPriceCoins: 77,
    });
    const creator = await createUser({ displayName: 'Creator', role: 'viewer', channelId: null });

    const visible = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/pool-visible.webm',
      durationMs: 1000,
      aiAutoTitle: 'Pool Visible',
      createdByUserId: creator.id,
    } satisfies Prisma.MemeAssetUncheckedCreateInput);
    const hidden = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/pool-hidden.webm',
      durationMs: 1000,
      aiAutoTitle: 'Pool Hidden',
      poolVisibility: 'hidden',
      createdByUserId: creator.id,
    } satisfies Prisma.MemeAssetUncheckedCreateInput);

    const res = await request(makeApp())
      .get(`/channels/${channel.slug}/memes?limit=10`)
      .set('Host', 'example.com');

    expect(res.status).toBe(200);
    const ids = (res.body?.items as Array<{ memeAssetId: string }>).map((item) => item.memeAssetId);
    expect(ids).toContain(visible.id);
    expect(ids).not.toContain(hidden.id);

    const item = (res.body?.items as Array<{ memeAssetId: string; priceCoins: number }>).find(
      (row) => row.memeAssetId === visible.id
    );
    expect(item?.priceCoins).toBe(77);
  });
});
