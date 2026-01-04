import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { prisma } from '../src/lib/prisma.js';
import { setupRoutes } from '../src/routes/index.js';

function rand(): string {
  return Math.random().toString(16).slice(2);
}

function makeJwt(payload: Record<string, any>): string {
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
    const channel = await prisma.channel.create({
      data: { slug: `ch_${rand()}`, name: `Channel ${rand()}`, defaultPriceCoins: 123, memeCatalogMode: 'pool_all' } as any,
      select: { id: true, slug: true },
    });

    const viewer = await prisma.user.create({
      data: { displayName: `Viewer ${rand()}`, role: 'viewer', hasBetaAccess: false, channelId: null },
      select: { id: true },
    });

    const fileHash = `hash_${rand()}`;
    const fileUrl = `/uploads/memes/${rand()}.webm`;
    await prisma.fileHash.create({
      data: {
        hash: fileHash,
        filePath: fileUrl,
        referenceCount: 1,
        fileSize: BigInt(1),
        mimeType: 'video/webm',
      },
    });

    const asset = await prisma.memeAsset.create({
      data: {
        type: 'video',
        fileUrl,
        fileHash,
        durationMs: 1500,
        poolVisibility: 'visible',
        aiStatus: 'done',
        aiAutoTitle: 'Pool meme title',
        aiSearchText: 'Pool meme title tag1 tag2',
        aiCompletedAt: new Date(),
      } as any,
      select: { id: true },
    });

    // Channel page should list pool assets (id is MemeAsset.id in pool_all mode)
    const listRes = await request(makeApp()).get(`/channels/${channel.slug}`).set('Host', 'example.com');
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body?.memes)).toBe(true);
    expect(listRes.body.memes?.some((m: any) => m.id === asset.id)).toBe(true);

    const token = makeJwt({ userId: viewer.id, role: 'viewer', channelId: null });
    const actRes = await request(makeApp())
      .post(`/memes/${asset.id}/activate?channelSlug=${encodeURIComponent(channel.slug)}`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .set('Host', 'example.com')
      .send({});

    expect(actRes.status).toBe(200);
    expect(actRes.body?.activation?.status).toBe('queued');
    expect(typeof actRes.body?.activation?.memeId).toBe('string');

    const cm = await prisma.channelMeme.findUnique({
      where: { channelId_memeAssetId: { channelId: channel.id, memeAssetId: asset.id } },
      select: { id: true, legacyMemeId: true, status: true, deletedAt: true, priceCoins: true },
    });
    expect(cm?.status).toBe('approved');
    expect(cm?.deletedAt).toBeNull();
    expect(typeof cm?.legacyMemeId).toBe('string');
    expect(cm?.priceCoins).toBe(123);

    const legacy = cm?.legacyMemeId ? await prisma.meme.findUnique({ where: { id: cm.legacyMemeId } }) : null;
    expect(legacy?.channelId).toBe(channel.id);
    expect(legacy?.status).toBe('approved');
  });
});


