import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { prisma } from '../src/lib/prisma.js';
import { authenticate } from '../src/middleware/auth.js';
import { requireBetaAccess } from '../src/middleware/betaAccess.js';
import { streamerRoutes } from '../src/routes/streamer.js';
import { ownerRoutes } from '../src/routes/owner.js';

function makeJwt(payload: Record<string, any>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
}

async function ensureFileHash(hash: string, filePath: string) {
  await prisma.fileHash.upsert({
    where: { hash },
    create: {
      hash,
      filePath,
      fileSize: 1n,
      mimeType: 'video/mp4',
    },
    update: {},
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
  it('GET /streamer/memes returns AI fields only when includeAi=1', async () => {
    const channel = await prisma.channel.create({ data: { slug: `s-${Date.now()}`, name: 'C' } });
    const streamer = await prisma.user.create({ data: { displayName: 'S', role: 'streamer', channelId: channel.id } });
    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });

    await ensureFileHash('a'.repeat(64), '/uploads/memes/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mp4');
    const asset = await prisma.memeAsset.create({
      data: {
        type: 'video',
        fileUrl: '/uploads/memes/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mp4',
        fileHash: 'a'.repeat(64),
        durationMs: 1000,
        aiStatus: 'done',
        aiAutoTitle: 'AI title',
      },
    });

    await prisma.channelMeme.create({
      data: {
        channelId: channel.id,
        memeAssetId: asset.id,
        title: 'T',
        priceCoins: 100,
        status: 'approved',
        deletedAt: null,
        aiAutoDescription: 'desc',
        aiAutoTagNamesJson: ['x', 'y'],
      } as any,
    });

    let res = await request(makeApp()).get('/streamer/memes').set('Cookie', [`token=${encodeURIComponent(token)}`]);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].aiAutoDescription).toBeUndefined();

    res = await request(makeApp()).get('/streamer/memes?includeAi=1').set('Cookie', [`token=${encodeURIComponent(token)}`]);
    expect(res.status).toBe(200);
    expect(res.body[0].aiAutoDescription).toBe('desc');
    expect(res.body[0].aiAutoTitle).toBe('AI title');
    expect(res.body[0].aiStatus).toBe('done');
    expect(Array.isArray(res.body[0].aiAutoTagNames)).toBe(true);
  });

  it('POST /streamer/memes/:id/ai/regenerate enforces minAge + cooldown and queues MemeSubmission', async () => {
    const channel = await prisma.channel.create({ data: { slug: `r-${Date.now()}`, name: 'C' } });
    const streamer = await prisma.user.create({ data: { displayName: 'S', role: 'streamer', channelId: channel.id } });
    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });

    await ensureFileHash('b'.repeat(64), '/uploads/memes/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.mp4');
    const asset = await prisma.memeAsset.create({
      data: {
        type: 'video',
        fileUrl: '/uploads/memes/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.mp4',
        fileHash: 'b'.repeat(64),
        durationMs: 1200,
      },
    });

    const tooSoon = await prisma.channelMeme.create({
      data: {
        channelId: channel.id,
        memeAssetId: asset.id,
        title: 'Soon',
        priceCoins: 100,
        status: 'approved',
        deletedAt: null,
        aiAutoDescription: null,
        createdAt: new Date(Date.now() - 60_000),
      } as any,
      select: { id: true },
    });

    let res = await request(makeApp())
      .post(`/streamer/memes/${tooSoon.id}/ai/regenerate`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);
    expect(res.status).toBe(400);
    expect(res.body?.errorCode).toBe('AI_REGENERATE_TOO_SOON');
    expect(typeof res.body?.retryAfterSeconds).toBe('number');

    const ok = await prisma.channelMeme.create({
      data: {
        channelId: channel.id,
        memeAssetId: asset.id,
        title: 'Ok',
        priceCoins: 100,
        status: 'approved',
        deletedAt: null,
        aiAutoDescription: null,
        createdAt: new Date(Date.now() - 6 * 60_000),
      } as any,
      select: { id: true },
    });

    res = await request(makeApp())
      .post(`/streamer/memes/${ok.id}/ai/regenerate`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);
    expect(res.status).toBe(202);
    expect(typeof res.body?.submissionId).toBe('string');

    const submission = await prisma.memeSubmission.findUnique({ where: { id: res.body.submissionId } });
    expect(submission?.channelId).toBe(channel.id);
    expect(submission?.memeAssetId).toBe(asset.id);
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

  it('GET /owner/ai/status is admin-only and returns queueCounts', async () => {
    const channel = await prisma.channel.create({ data: { slug: `o-${Date.now()}`, name: 'C' } });
    const viewer = await prisma.user.create({ data: { displayName: 'V', role: 'viewer', channelId: channel.id } });
    const admin = await prisma.user.create({ data: { displayName: 'A', role: 'admin', channelId: channel.id } });

    const viewerToken = makeJwt({ userId: viewer.id, role: viewer.role, channelId: channel.id });
    const adminToken = makeJwt({ userId: admin.id, role: admin.role, channelId: channel.id });

    let res = await request(makeApp()).get('/owner/ai/status').set('Cookie', [`token=${encodeURIComponent(viewerToken)}`]);
    expect(res.status).toBe(403);

    res = await request(makeApp()).get('/owner/ai/status').set('Cookie', [`token=${encodeURIComponent(adminToken)}`]);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('queueCounts');
    expect(typeof res.body.queueCounts.pending).toBe('number');
    expect(typeof res.body.queueCounts.failedReady).toBe('number');
    expect(typeof res.body.queueCounts.processingStuck).toBe('number');
  });
});



