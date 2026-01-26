import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { setupRoutes } from '../src/routes/index.js';
import { createChannel, createFileHash, createMemeAsset, createUser, createWallet } from './factories/index.js';

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

describe('channel catalog mode: pool_all', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development'; // avoid CSRF Origin requirement
    process.env.PORT = '3001';
    process.env.DOMAIN = 'example.com';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('lists pool memes on channel page and can activate MemeAsset by passing channelSlug', async () => {
    const channel = await createChannel({
      slug: `ch_${rand()}`,
      name: `Channel ${rand()}`,
      defaultPriceCoins: 123,
      memeCatalogMode: 'pool_all',
    } satisfies Prisma.ChannelCreateInput);

    const viewer = await createUser({
      displayName: `Viewer ${rand()}`,
      role: 'viewer',
      hasBetaAccess: false,
      channelId: null,
    });

    // Give viewer enough balance to activate (otherwise expect 400 Insufficient balance).
    await createWallet({ userId: viewer.id, channelId: channel.id, balance: 1000 });

    const fileHash = `hash_${rand()}`;
    const fileUrl = `/uploads/memes/${rand()}.webm`;
    await createFileHash({
      hash: fileHash,
      filePath: fileUrl,
      referenceCount: 1,
      fileSize: BigInt(1),
      mimeType: 'video/webm',
    });

    const assetData = {
      type: 'video',
      fileUrl,
      fileHash,
      durationMs: 1500,
      status: 'active',
      aiStatus: 'done',
      aiAutoTitle: 'Pool meme title',
      aiSearchText: 'Pool meme title tag1 tag2',
      aiCompletedAt: new Date(),
    } satisfies Prisma.MemeAssetCreateInput;
    const asset = await createMemeAsset(assetData);

    // Channel page should list pool assets (id is MemeAsset.id in pool_all mode)
    const listRes = await request(makeApp()).get(`/channels/${channel.slug}`).set('Host', 'example.com');
    expect(listRes.status).toBe(200);
    expect(listRes.body?.memeCatalogMode).toBe('pool_all');
    expect(Array.isArray(listRes.body?.memes)).toBe(true);
    const poolMemes = Array.isArray(listRes.body?.memes) ? (listRes.body.memes as Array<{ id: string }>) : [];
    expect(poolMemes.some((m) => m.id === asset.id)).toBe(true);

    // includeMemes=false should still include channel meta + memeCatalogMode (used by UI)
    const metaRes = await request(makeApp())
      .get(`/channels/${channel.slug}?includeMemes=false`)
      .set('Host', 'example.com');
    expect(metaRes.status).toBe(200);
    expect(metaRes.body?.memeCatalogMode).toBe('pool_all');
    expect(metaRes.body?.memes).toBeUndefined();

    const token = makeJwt({ userId: viewer.id, role: 'viewer', channelId: null });
    const actRes = await request(makeApp())
      .post(`/memes/${asset.id}/activate?channelSlug=${encodeURIComponent(channel.slug)}`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .set('Host', 'example.com')
      .send({});

    expect(actRes.status).toBe(200);
    expect(actRes.body?.activation?.status).toBe('queued');
    expect(typeof actRes.body?.activation?.channelMemeId).toBe('string');

    const cm = await prisma.channelMeme.findUnique({
      where: { channelId_memeAssetId: { channelId: channel.id, memeAssetId: asset.id } },
      select: { id: true, status: true, deletedAt: true, priceCoins: true },
    });
    expect(cm?.status).toBe('approved');
    expect(cm?.deletedAt).toBeNull();
    expect(cm?.priceCoins).toBe(123);
    expect(cm?.id).toBe(actRes.body?.activation?.channelMemeId);
  });
});
