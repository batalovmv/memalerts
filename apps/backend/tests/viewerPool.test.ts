import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Prisma } from '@prisma/client';

import { prisma } from '../src/lib/prisma.js';
import { setupRoutes } from '../src/routes/index.js';
import { createChannel, createMemeAsset, createUser } from './factories/index.js';

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

describe('viewer pool operations', () => {
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

  it('creates a pool submission for a viewer and uses AI title fallback', async () => {
    const channel = await createChannel({
      slug: `pool_${rand()}`,
      name: 'Pool Channel',
      memeCatalogMode: 'pool_all',
    });
    await createUser({ displayName: 'Streamer', role: 'streamer', channelId: channel.id });
    const viewer = await createUser({ displayName: 'Viewer', role: 'viewer', channelId: null });

    const asset = await createMemeAsset({
      type: 'video',
      fileUrl: `/uploads/memes/${rand()}.webm`,
      durationMs: 1200,
      aiAutoTitle: 'AI Pool Title',
      status: 'active',
    } satisfies Prisma.MemeAssetUncheckedCreateInput);

    const token = makeJwt({ userId: viewer.id, role: viewer.role, channelId: null });
    const res = await request(makeApp())
      .post('/submissions/pool')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ channelId: channel.id, memeAssetId: asset.id });

    expect(res.status).toBe(201);
    expect(res.body?.status).toBe('pending');
    expect(res.body?.sourceKind).toBe('pool');
    expect(res.body?.memeAssetId).toBe(asset.id);
    expect(res.body?.sourceUrl).toBe(asset.fileUrl);
    expect(res.body?.title).toBe('AI Pool Title');

    const stored = await prisma.memeSubmission.findUnique({
      where: { id: res.body?.id },
      select: { submitterUserId: true, channelId: true, sourceKind: true },
    });
    expect(stored?.submitterUserId).toBe(viewer.id);
    expect(stored?.channelId).toBe(channel.id);
    expect(stored?.sourceKind).toBe('pool');
  });

  it('adopts pool meme immediately for channel owner and copies AI fields', async () => {
    const channel = await createChannel({
      slug: `pool_${rand()}`,
      name: 'Owner Channel',
      memeCatalogMode: 'pool_all',
      defaultPriceCoins: 333,
    });
    const streamer = await createUser({ displayName: 'Streamer', role: 'streamer', channelId: channel.id });

    const asset = await createMemeAsset({
      type: 'video',
      fileUrl: `/uploads/memes/${rand()}.webm`,
      durationMs: 900,
      aiStatus: 'done',
      aiAutoTitle: 'AI Title',
      aiAutoDescription: 'AI Description',
      aiAutoTagNames: ['tag1', 'tag2'],
      aiSearchText: 'AI Description Search',
      status: 'active',
    } satisfies Prisma.MemeAssetUncheckedCreateInput);

    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const res = await request(makeApp())
      .post('/submissions/pool')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ channelId: channel.id, memeAssetId: asset.id, title: 'Direct Title' });

    expect(res.status).toBe(201);
    expect(res.body?.isDirectApproval).toBe(true);
    expect(res.body?.status).toBe('approved');
    expect(res.body?.channelMemeId).toBeTruthy();
    expect(res.body?.memeAssetId).toBe(asset.id);

    const cm = await prisma.channelMeme.findUnique({
      where: { channelId_memeAssetId: { channelId: channel.id, memeAssetId: asset.id } },
      select: { priceCoins: true, memeAssetId: true },
    });
    expect(cm?.priceCoins).toBe(333);
    const updatedAsset = cm?.memeAssetId
      ? await prisma.memeAsset.findUnique({ where: { id: cm.memeAssetId } })
      : null;
    expect(updatedAsset?.aiAutoDescription).toBe('AI Description');
    expect(Array.isArray(updatedAsset?.aiAutoTagNames)).toBe(true);
    expect(updatedAsset?.aiSearchText).toBe('AI Description Search');
  });
});
