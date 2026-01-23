import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { Prisma } from '@prisma/client';

import { setupRoutes } from '../src/routes/index.js';
import { createChannel, createChannelMeme, createMemeAsset, createUser } from './factories/index.js';

function rand(): string {
  return Math.random().toString(16).slice(2);
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.set('io', { to: () => ({ emit: () => {} }) });
  setupRoutes(app);
  return app;
}

describe('public channel API', () => {
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

  it('returns channel meta with owner and stats without memes by default', async () => {
    const channel = await createChannel({
      slug: `pub_${rand()}`,
      name: 'Public Channel',
      rewardTitle: 'Reward',
      submissionsEnabled: true,
    });
    const owner = await createUser({
      displayName: 'Streamer',
      role: 'streamer',
      channelId: channel.id,
      profileImageUrl: 'https://cdn.example.com/avatar.png',
    });
    const asset = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/meta.webm',
      durationMs: 1200,
    });
    await createChannelMeme({
      channelId: channel.id,
      memeAssetId: asset.id,
      title: 'Meta Meme',
      priceCoins: 111,
      status: 'approved',
    });

    const res = await request(makeApp()).get(`/public/channels/${channel.slug}`).set('Host', 'example.com');

    expect(res.status).toBe(200);
    expect(res.body?.slug).toBe(channel.slug);
    expect(res.body?.owner).toEqual({
      id: owner.id,
      displayName: owner.displayName,
      profileImageUrl: owner.profileImageUrl,
    });
    expect(res.body?.stats?.memesCount).toBe(1);
    expect(res.body?.stats?.usersCount).toBe(1);
    expect(res.body?.memes).toBeUndefined();
  });

  it('includes memes with pagination and sorting when includeMemes=true', async () => {
    const channel = await createChannel({
      slug: `pub_${rand()}`,
      name: 'Public Channel',
    });
    const creator = await createUser({ displayName: 'Creator', role: 'viewer', channelId: null });

    const t1 = new Date('2023-01-01T00:00:00.000Z');
    const t2 = new Date('2023-01-02T00:00:00.000Z');
    const t3 = new Date('2023-01-03T00:00:00.000Z');

    const asset1 = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/old.webm',
      durationMs: 1000,
      createdAt: t1,
      createdByUserId: creator.id,
    } satisfies Prisma.MemeAssetUncheckedCreateInput);
    const asset2 = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/mid.webm',
      durationMs: 1000,
      createdAt: t2,
      createdByUserId: creator.id,
    } satisfies Prisma.MemeAssetUncheckedCreateInput);
    const asset3 = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/new.webm',
      durationMs: 1000,
      createdAt: t3,
      createdByUserId: creator.id,
    } satisfies Prisma.MemeAssetUncheckedCreateInput);

    await createChannelMeme({
      channelId: channel.id,
      memeAssetId: asset1.id,
      title: 'Old',
      priceCoins: 10,
      createdAt: t1,
    });
    const meme2 = await createChannelMeme({
      channelId: channel.id,
      memeAssetId: asset2.id,
      title: 'Mid',
      priceCoins: 20,
      createdAt: t2,
    });
    await createChannelMeme({
      channelId: channel.id,
      memeAssetId: asset3.id,
      title: 'New',
      priceCoins: 30,
      createdAt: t3,
    });

    const res = await request(makeApp())
      .get(`/public/channels/${channel.slug}?includeMemes=true&limit=1&offset=1&sortBy=createdAt&sortOrder=asc`)
      .set('Host', 'example.com');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.memes)).toBe(true);
    expect(res.body.memes).toHaveLength(1);
    expect(res.body.memes[0].channelMemeId).toBe(meme2.id);
    expect(res.body.memes[0].createdBy).toEqual({ id: creator.id, displayName: creator.displayName });
    expect(res.body?.memesPage).toEqual({
      limit: 1,
      offset: 1,
      returned: 1,
      total: 3,
    });
    expect(res.body?.stats?.memesCount).toBe(3);
  });

  it('lists memes with price sorting and a sanitized DTO', async () => {
    const channel = await createChannel({ slug: `pub_${rand()}`, name: 'Public Channel' });
    const creator = await createUser({ displayName: 'Creator', role: 'viewer', channelId: null });

    const assetCheap = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/cheap.webm',
      durationMs: 1000,
      createdByUserId: creator.id,
    } satisfies Prisma.MemeAssetUncheckedCreateInput);
    const assetMid = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/mid.webm',
      durationMs: 1000,
      createdByUserId: creator.id,
    } satisfies Prisma.MemeAssetUncheckedCreateInput);
    const assetExp = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/expensive.webm',
      durationMs: 1000,
      createdByUserId: creator.id,
    } satisfies Prisma.MemeAssetUncheckedCreateInput);

    await createChannelMeme({
      channelId: channel.id,
      memeAssetId: assetExp.id,
      title: 'Expensive',
      priceCoins: 300,
    });
    await createChannelMeme({
      channelId: channel.id,
      memeAssetId: assetCheap.id,
      title: 'Cheap',
      priceCoins: 50,
    });
    await createChannelMeme({
      channelId: channel.id,
      memeAssetId: assetMid.id,
      title: 'Mid',
      priceCoins: 150,
    });

    const res = await request(makeApp())
      .get(`/public/channels/${channel.slug}/memes?limit=2&offset=0&sortBy=priceCoins&sortOrder=asc`)
      .set('Host', 'example.com');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].priceCoins).toBeLessThanOrEqual(res.body[1].priceCoins);

    const itemKeys = Object.keys(res.body[0]).sort();
    expect(itemKeys).toEqual(
      [
        'activationsCount',
        'channelId',
        'channelMemeId',
        'createdAt',
        'createdBy',
        'durationMs',
        'fileUrl',
        'id',
        'memeAssetId',
        'priceCoins',
        'previewUrl',
        'title',
        'type',
        'variants',
      ].sort()
    );
    expect(Object.keys(res.body[0].createdBy).sort()).toEqual(['displayName', 'id']);
  });

  it('searches channel memes by query', async () => {
    const channel = await createChannel({ slug: `pub_${rand()}`, name: 'Public Channel' });
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
    await createChannelMeme({
      channelId: channel.id,
      memeAssetId: assetCat.id,
      title: 'Cat meme',
      priceCoins: 100,
    });
    await createChannelMeme({
      channelId: channel.id,
      memeAssetId: assetDog.id,
      title: 'Dog meme',
      priceCoins: 100,
    });

    const res = await request(makeApp())
      .get(`/public/channels/${channel.slug}/memes/search?q=cat`)
      .set('Host', 'example.com');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title.toLowerCase()).toContain('cat');
  });

  it('returns pool memes when memeCatalogMode=pool_all', async () => {
    const channel = await createChannel({
      slug: `pub_${rand()}`,
      name: 'Pool Channel',
      memeCatalogMode: 'pool_all',
      defaultPriceCoins: 77,
    });
    const creator = await createUser({ displayName: 'Pool Creator', role: 'viewer', channelId: null });

    const visibleAsset = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/pool-visible.webm',
      durationMs: 1200,
      aiAutoTitle: 'Pool Visible',
      createdByUserId: creator.id,
    } satisfies Prisma.MemeAssetUncheckedCreateInput);
    const hiddenAsset = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/pool-hidden.webm',
      durationMs: 1200,
      aiAutoTitle: 'Pool Hidden',
      poolVisibility: 'hidden',
      createdByUserId: creator.id,
    } satisfies Prisma.MemeAssetUncheckedCreateInput);

    const res = await request(makeApp())
      .get(`/public/channels/${channel.slug}?includeMemes=true`)
      .set('Host', 'example.com');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.memes)).toBe(true);
    expect(res.body.memes.some((m: { memeAssetId: string }) => m.memeAssetId === visibleAsset.id)).toBe(true);
    expect(res.body.memes.some((m: { memeAssetId: string }) => m.memeAssetId === hiddenAsset.id)).toBe(false);
    const visible = res.body.memes.find((m: { memeAssetId: string }) => m.memeAssetId === visibleAsset.id);
    expect(visible?.priceCoins).toBe(77);
    expect(typeof res.body?.memesPage?.total).toBe('number');
  });

  it('returns 404 for unknown channel slug', async () => {
    const res = await request(makeApp()).get('/public/channels/unknown_slug').set('Host', 'example.com');

    expect(res.status).toBe(404);
    expect(res.body?.errorCode).toBe('CHANNEL_NOT_FOUND');
  });
});
