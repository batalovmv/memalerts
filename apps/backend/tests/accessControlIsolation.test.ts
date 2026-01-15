import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Prisma } from '@prisma/client';

import { prisma } from '../src/lib/prisma.js';
import { authenticate } from '../src/middleware/auth.js';
import { requireBetaAccess } from '../src/middleware/betaAccess.js';
import { submissionRoutes } from '../src/routes/submissions.js';
import { streamerRoutes } from '../src/routes/streamer.js';
import { ownerRoutes } from '../src/routes/owner.js';
import {
  createChannel,
  createChannelMeme,
  createMemeAsset,
  createSubmission,
  createUser,
} from './factories/index.js';

function makeJwt(payload: Record<string, unknown>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/submissions', submissionRoutes);
  app.use('/streamer', authenticate, requireBetaAccess, streamerRoutes);
  app.use('/owner', authenticate, requireBetaAccess, ownerRoutes);
  return app;
}

describe('access isolation: submissions and channel scope', () => {
  it('blocks viewer from resubmitting or listing another viewer submission', async () => {
    const channel = await createChannel({ slug: `c-${Date.now()}`, name: 'C' });
    const viewerA = await createUser({
      displayName: 'Viewer A',
      role: 'viewer',
      hasBetaAccess: false,
      channelId: null,
    });
    const viewerB = await createUser({
      displayName: 'Viewer B',
      role: 'viewer',
      hasBetaAccess: false,
      channelId: null,
    });

    const submissionB = await createSubmission({
      channelId: channel.id,
      submitterUserId: viewerB.id,
      title: 'B submission',
      type: 'video',
      fileUrlTemp: '/uploads/tmp/b.mp4',
      status: 'needs_changes',
    });

    const tokenA = makeJwt({ userId: viewerA.id, role: viewerA.role, channelId: null });
    const resubmit = await request(makeApp())
      .post(`/submissions/${submissionB.id}/resubmit`)
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenA)}`])
      .send({ title: 'Nope', notes: null, tags: [] });

    expect(resubmit.status).toBe(404);
    expect(resubmit.body?.errorCode).toBe('SUBMISSION_NOT_FOUND');

    const mine = await request(makeApp())
      .get('/submissions/mine')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenA)}`]);

    expect(mine.status).toBe(200);
    expect(Array.isArray(mine.body?.items)).toBe(true);
    const mineItems = Array.isArray(mine.body?.items) ? (mine.body.items as Array<{ id: string }>) : [];
    expect(mineItems.find((s) => s.id === submissionB.id)).toBeUndefined();
  });

  it('blocks streamer from moderating submissions from another channel', async () => {
    const channelA = await createChannel({ slug: `a-${Date.now()}`, name: 'A' });
    const channelB = await createChannel({ slug: `b-${Date.now()}`, name: 'B' });

    const streamerA = await createUser({
      displayName: 'Streamer A',
      role: 'streamer',
      channelId: channelA.id,
    });
    const viewerB = await createUser({ displayName: 'Viewer B', role: 'viewer', channelId: null });

    const submissionB = await createSubmission({
      channelId: channelB.id,
      submitterUserId: viewerB.id,
      title: 'Pending',
      type: 'video',
      fileUrlTemp: '/uploads/tmp/pending.mp4',
      status: 'pending',
    });

    const tokenA = makeJwt({ userId: streamerA.id, role: streamerA.role, channelId: channelA.id });

    const list = await request(makeApp())
      .get('/streamer/submissions')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenA)}`]);

    expect(list.status).toBe(200);
    expect(Array.isArray(list.body?.items)).toBe(true);
    const listItems = Array.isArray(list.body?.items) ? (list.body.items as Array<{ id: string }>) : [];
    expect(listItems.find((s) => s.id === submissionB.id)).toBeUndefined();

    const approve = await request(makeApp())
      .post(`/streamer/submissions/${submissionB.id}/approve`)
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenA)}`])
      .send({});

    expect(approve.status).toBe(404);
    expect(approve.body?.errorCode).toBe('SUBMISSION_NOT_FOUND');

    const reject = await request(makeApp())
      .post(`/streamer/submissions/${submissionB.id}/reject`)
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenA)}`])
      .send({ moderatorNotes: 'no' });

    expect(reject.status).toBe(404);
    expect(reject.body?.errorCode).toBe('SUBMISSION_NOT_FOUND');
  });

  it('blocks streamer from deleting memes in another channel', async () => {
    const channelA = await createChannel({ slug: `ma-${Date.now()}`, name: 'A' });
    const channelB = await createChannel({ slug: `mb-${Date.now()}`, name: 'B' });

    const streamerA = await createUser({
      displayName: 'Streamer A',
      role: 'streamer',
      channelId: channelA.id,
    });

    const asset = await createMemeAsset({
      type: 'video',
      fileUrl: '/uploads/memes/asset.mp4',
      durationMs: 1000,
    });

    const channelMemeData = {
      channelId: channelB.id,
      memeAssetId: asset.id,
      title: 'B meme',
      priceCoins: 100,
      status: 'approved',
    } satisfies Prisma.ChannelMemeCreateInput;
    const cm = await createChannelMeme(channelMemeData);

    const tokenA = makeJwt({ userId: streamerA.id, role: streamerA.role, channelId: channelA.id });

    const del = await request(makeApp())
      .delete(`/streamer/memes/${cm.id}`)
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(tokenA)}`]);

    expect(del.status).toBe(404);
    expect(del.body?.errorCode).toBe('CHANNEL_MEME_NOT_FOUND');
  });

  it('blocks non-admin from owner routes', async () => {
    const channel = await createChannel({ slug: `o-${Date.now()}`, name: 'O' });
    const viewer = await createUser({ displayName: 'Viewer', role: 'viewer', channelId: channel.id });
    const admin = await createUser({ displayName: 'Admin', role: 'admin', channelId: channel.id });

    const viewerToken = makeJwt({ userId: viewer.id, role: viewer.role, channelId: channel.id });
    const adminToken = makeJwt({ userId: admin.id, role: admin.role, channelId: channel.id });

    const deny = await request(makeApp())
      .get('/owner/meme-assets')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(viewerToken)}`]);

    expect(deny.status).toBe(403);
    expect(deny.body?.errorCode).toBe('ROLE_REQUIRED');

    const ok = await request(makeApp())
      .get('/owner/meme-assets')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(adminToken)}`]);

    expect(ok.status).toBe(200);
  });
});
