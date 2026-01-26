import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { authenticate } from '../src/middleware/auth.js';
import { requireBetaAccess } from '../src/middleware/betaAccess.js';
import { streamerRoutes } from '../src/routes/streamer.js';
import { ownerRoutes } from '../src/routes/owner.js';
import { createChannel, createChannelMeme, createFileHash, createMemeAsset, createUser } from './factories/index.js';

function makeJwt(payload: Record<string, unknown>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
}

async function ensureFileHash(hash: string, filePath: string) {
  await createFileHash({
    hash,
    filePath,
    fileSize: 1n,
    mimeType: 'video/mp4',
  });
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/streamer', authenticate, requireBetaAccess, streamerRoutes);
  app.use('/owner', authenticate, requireBetaAccess, ownerRoutes);
  return app;
}

describe('AI regenerate + AI status', () => {
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

  it('GET /streamer/memes returns AI fields only when includeAi=1', async () => {
    const channel = await createChannel({ slug: `s-${Date.now()}`, name: 'C' });
    const streamer = await createUser({ displayName: 'S', role: 'streamer', channelId: channel.id });
    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });

    await ensureFileHash(
      'a'.repeat(64),
      '/uploads/memes/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mp4'
    );
    const asset = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mp4',
      fileHash: 'a'.repeat(64),
      durationMs: 1000,
      aiStatus: 'done',
      aiAutoTitle: 'AI title',
      aiAutoDescription: 'desc',
      aiAutoTagNames: ['x', 'y'],
    });

    const channelMemeData = {
      channelId: channel.id,
      memeAssetId: asset.id,
      title: 'T',
      priceCoins: 100,
      status: 'approved',
      deletedAt: null,
    } satisfies Prisma.ChannelMemeCreateInput;
    await createChannelMeme(channelMemeData);

    let res = await request(makeApp())
      .get('/streamer/memes')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].aiAutoDescription).toBeUndefined();

    res = await request(makeApp())
      .get('/streamer/memes?includeAi=1')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);
    expect(res.status).toBe(200);
    expect(res.body[0].aiAutoDescription).toBe('desc');
    expect(res.body[0].aiAutoTitle).toBe('AI title');
    expect(res.body[0].aiStatus).toBe('done');
    expect(Array.isArray(res.body[0].aiAutoTagNames)).toBe(true);
  });

  it('POST /streamer/memes/:id/ai/regenerate enforces minAge + cooldown and queues MemeSubmission', async () => {
    const channel = await createChannel({ slug: `r-${Date.now()}`, name: 'C' });
    const streamer = await createUser({ displayName: 'S', role: 'streamer', channelId: channel.id });
    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });

    await ensureFileHash(
      'b'.repeat(64),
      '/uploads/memes/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.mp4'
    );
    const assetTooSoon = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.mp4',
      fileHash: 'b'.repeat(64),
      durationMs: 1200,
      aiAutoDescription: null,
    });

    const tooSoonData = {
      channelId: channel.id,
      memeAssetId: assetTooSoon.id,
      title: 'Soon',
      priceCoins: 100,
      status: 'approved',
      deletedAt: null,
      createdAt: new Date(Date.now() - 60_000),
    } satisfies Prisma.ChannelMemeCreateInput;
    const tooSoon = await createChannelMeme(tooSoonData);

    let res = await request(makeApp())
      .post(`/streamer/memes/${tooSoon.id}/ai/regenerate`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);
    expect(res.status).toBe(400);
    expect(res.body?.errorCode).toBe('AI_REGENERATE_TOO_SOON');
    expect(typeof res.body?.retryAfterSeconds).toBe('number');

    await ensureFileHash(
      'c'.repeat(64),
      '/uploads/memes/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.mp4'
    );
    const assetOk = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.mp4',
      fileHash: 'c'.repeat(64),
      durationMs: 1200,
      aiAutoDescription: null,
    });

    const okData = {
      channelId: channel.id,
      memeAssetId: assetOk.id,
      title: 'Ok',
      priceCoins: 100,
      status: 'approved',
      deletedAt: null,
      createdAt: new Date(Date.now() - 6 * 60_000),
    } satisfies Prisma.ChannelMemeCreateInput;
    const ok = await createChannelMeme(okData);

    res = await request(makeApp())
      .post(`/streamer/memes/${ok.id}/ai/regenerate`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);
    expect(res.status).toBe(202);
    expect(typeof res.body?.submissionId).toBe('string');

    const submission = await prisma.memeSubmission.findUnique({ where: { id: res.body.submissionId } });
    expect(submission?.channelId).toBe(channel.id);
    expect(submission?.memeAssetId).toBe(assetOk.id);
    expect(submission?.aiStatus).toBe('pending');
    expect(submission?.sourceKind).toBe('upload');

    // Immediately again => cooldown
    const res2 = await request(makeApp())
      .post(`/streamer/memes/${ok.id}/ai/regenerate`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);
    expect(res2.status).toBe(429);
    expect(res2.body?.errorCode).toBe('AI_REGENERATE_COOLDOWN');
    expect(typeof res2.body?.retryAfterSeconds).toBe('number');
  });

  it('POST /streamer/memes/:id/ai/regenerate is limited to the streamers channel', async () => {
    const channel = await createChannel({ slug: `own-${Date.now()}`, name: 'Own' });
    const otherChannel = await createChannel({ slug: `other-${Date.now()}`, name: 'Other' });
    const streamer = await createUser({ displayName: 'S', role: 'streamer', channelId: channel.id });
    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });

    const otherAsset = await createMemeAsset({
      type: 'video',
      fileUrl: `/uploads/memes/${Date.now()}-other.mp4`,
      fileHash: `hash-${Date.now()}-other`,
      durationMs: 1200,
      aiAutoDescription: null,
    });
    const otherMeme = await createChannelMeme({
      channelId: otherChannel.id,
      memeAssetId: otherAsset.id,
      createdAt: new Date(Date.now() - 6 * 60_000),
    });

    const res = await request(makeApp())
      .post(`/streamer/memes/${otherMeme.id}/ai/regenerate`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(404);
    expect(res.body?.errorCode).toBe('CHANNEL_MEME_NOT_FOUND');
  });

  it('POST /streamer/memes/:id/ai/regenerate allows re-run when aiAutoDescription is a UI placeholder', async () => {
    const channel = await createChannel({ slug: `p-${Date.now()}`, name: 'C' });
    const streamer = await createUser({ displayName: 'S', role: 'streamer', channelId: channel.id });
    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });

    await ensureFileHash(
      'd'.repeat(64),
      '/uploads/memes/dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd.mp4'
    );
    const asset = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd.mp4',
      fileHash: 'd'.repeat(64),
      durationMs: 1200,
      aiAutoDescription: 'Мем',
    });

    const placeholderData = {
      channelId: channel.id,
      memeAssetId: asset.id,
      title: 'Placeholder',
      priceCoins: 100,
      status: 'approved',
      deletedAt: null,
      createdAt: new Date(Date.now() - 6 * 60_000),
    } satisfies Prisma.ChannelMemeCreateInput;
    const cm = await createChannelMeme(placeholderData);

    const res = await request(makeApp())
      .post(`/streamer/memes/${cm.id}/ai/regenerate`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(202);
    expect(typeof res.body?.submissionId).toBe('string');
  });

  it('POST /streamer/memes/:id/ai/regenerate allows re-run when aiAutoDescription duplicates title', async () => {
    const channel = await createChannel({ slug: `pt-${Date.now()}`, name: 'C' });
    const streamer = await createUser({ displayName: 'S', role: 'streamer', channelId: channel.id });
    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });

    await ensureFileHash(
      'e'.repeat(64),
      '/uploads/memes/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.mp4'
    );
    const asset = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.mp4',
      fileHash: 'e'.repeat(64),
      durationMs: 1200,
      aiAutoDescription: 'test',
    });

    const duplicateData = {
      channelId: channel.id,
      memeAssetId: asset.id,
      title: 'test',
      priceCoins: 100,
      status: 'approved',
      deletedAt: null,
      createdAt: new Date(Date.now() - 6 * 60_000),
    } satisfies Prisma.ChannelMemeCreateInput;
    const cm = await createChannelMeme(duplicateData);

    const res = await request(makeApp())
      .post(`/streamer/memes/${cm.id}/ai/regenerate`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(202);
    expect(typeof res.body?.submissionId).toBe('string');
  });

  it('POST /streamer/memes/:id/ai/regenerate blocks re-run when aiAutoDescription is real text', async () => {
    const channel = await createChannel({ slug: `pb-${Date.now()}`, name: 'C' });
    const streamer = await createUser({ displayName: 'S', role: 'streamer', channelId: channel.id });
    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });

    await ensureFileHash(
      'f'.repeat(64),
      '/uploads/memes/ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff.mp4'
    );
    const asset = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff.mp4',
      fileHash: 'f'.repeat(64),
      durationMs: 1200,
      aiAutoDescription: 'This is a real description',
    });

    const realDescData = {
      channelId: channel.id,
      memeAssetId: asset.id,
      title: 'Some title',
      priceCoins: 100,
      status: 'approved',
      deletedAt: null,
      createdAt: new Date(Date.now() - 6 * 60_000),
    } satisfies Prisma.ChannelMemeCreateInput;
    const cm = await createChannelMeme(realDescData);

    const res = await request(makeApp())
      .post(`/streamer/memes/${cm.id}/ai/regenerate`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(400);
    expect(res.body?.errorCode).toBe('AI_REGENERATE_NOT_ALLOWED');
    expect(res.body?.details?.reason).toBe('description_already_present');
  });

  it('GET /owner/ai/status is admin-only and returns queueCounts', async () => {
    const channel = await createChannel({ slug: `o-${Date.now()}`, name: 'C' });
    const viewer = await createUser({ displayName: 'V', role: 'viewer', channelId: channel.id });
    const admin = await createUser({ displayName: 'A', role: 'admin', channelId: channel.id });

    const viewerToken = makeJwt({ userId: viewer.id, role: viewer.role, channelId: channel.id });
    const adminToken = makeJwt({ userId: admin.id, role: admin.role, channelId: channel.id });

    let res = await request(makeApp())
      .get('/owner/ai/status')
      .set('Cookie', [`token=${encodeURIComponent(viewerToken)}`]);
    expect(res.status).toBe(403);

    res = await request(makeApp())
      .get('/owner/ai/status')
      .set('Cookie', [`token=${encodeURIComponent(adminToken)}`]);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('queueCounts');
    expect(typeof res.body.queueCounts.pending).toBe('number');
    expect(typeof res.body.queueCounts.failedReady).toBe('number');
    expect(typeof res.body.queueCounts.processingStuck).toBe('number');
  });
});
