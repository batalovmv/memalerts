import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { setupRoutes } from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { prisma } from '../src/lib/prisma.js';
import { createChannel, createChannelMeme, createMemeAsset, createUser } from './factories/index.js';

function makeJwt(payload: Record<string, unknown>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.set('io', { to: () => ({ emit: () => {} }) });
  setupRoutes(app);
  app.use(errorHandler);
  return app;
}

describe('streamer memes CRUD', () => {
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

  it('lists only channel memes for the streamer channel', async () => {
    const channel = await createChannel({ slug: 'streamer-memes', name: 'Streamer Memes' });
    const otherChannel = await createChannel({ slug: 'other-memes', name: 'Other Memes' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });

    const assetA = await createMemeAsset({ type: 'video', fileUrl: '/uploads/memes/a.webm', durationMs: 1000 });
    const assetB = await createMemeAsset({ type: 'video', fileUrl: '/uploads/memes/b.webm', durationMs: 1000 });
    const assetC = await createMemeAsset({ type: 'video', fileUrl: '/uploads/memes/c.webm', durationMs: 1000 });

    const approved = await createChannelMeme({
      channelId: channel.id,
      memeAssetId: assetA.id,
      title: 'Approved',
      status: 'approved',
      deletedAt: null,
    });
    await createChannelMeme({
      channelId: channel.id,
      memeAssetId: assetB.id,
      title: 'Deleted',
      status: 'disabled',
      deletedAt: new Date(),
    });
    await createChannelMeme({
      channelId: otherChannel.id,
      memeAssetId: assetC.id,
      title: 'Other Channel',
      status: 'approved',
      deletedAt: null,
    });

    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const res = await request(makeApp())
      .get('/streamer/memes')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.find((m: { id: string }) => m.id === approved.id)).toBeTruthy();
    expect(res.body.find((m: { title: string }) => m.title === 'Deleted')).toBeUndefined();
    expect(res.body.find((m: { title: string }) => m.title === 'Other Channel')).toBeUndefined();
  });

  it('updates meme title/price and validates input', async () => {
    const channel = await createChannel({ slug: 'update-meme', name: 'Update Meme' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const asset = await createMemeAsset({ type: 'video', fileUrl: '/uploads/memes/u.webm', durationMs: 1000 });
    const meme = await createChannelMeme({
      channelId: channel.id,
      memeAssetId: asset.id,
      title: 'Old title',
      priceCoins: 100,
    });

    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const updated = await request(makeApp())
      .patch(`/streamer/memes/${meme.id}`)
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ title: 'New title', priceCoins: 250 });

    expect(updated.status).toBe(200);
    expect(updated.body?.title).toBe('New title');
    expect(updated.body?.priceCoins).toBe(250);

    const invalid = await request(makeApp())
      .patch(`/streamer/memes/${meme.id}`)
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ priceCoins: -5 });

    expect(invalid.status).toBe(400);
    expect(invalid.body?.error).toBe('Validation error');
  });

  it('soft deletes a meme', async () => {
    const channel = await createChannel({ slug: 'delete-meme', name: 'Delete Meme' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const asset = await createMemeAsset({ type: 'video', fileUrl: '/uploads/memes/d.webm', durationMs: 1000 });
    const meme = await createChannelMeme({
      channelId: channel.id,
      memeAssetId: asset.id,
      title: 'Delete me',
      status: 'approved',
    });

    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const res = await request(makeApp())
      .delete(`/streamer/memes/${meme.id}`)
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(res.body?.status).toBe('disabled');
    expect(res.body?.deletedAt).toBeTruthy();

    const stored = await prisma.channelMeme.findUnique({
      where: { id: meme.id },
      select: { status: true, deletedAt: true },
    });
    expect(stored?.status).toBe('disabled');
    expect(stored?.deletedAt).toBeInstanceOf(Date);
  });

  it('blocks updates to memes from another channel', async () => {
    const channel = await createChannel({ slug: 'chan-a', name: 'Channel A' });
    const otherChannel = await createChannel({ slug: 'chan-b', name: 'Channel B' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const asset = await createMemeAsset({ type: 'video', fileUrl: '/uploads/memes/x.webm', durationMs: 1000 });
    const otherMeme = await createChannelMeme({
      channelId: otherChannel.id,
      memeAssetId: asset.id,
      title: 'Other channel meme',
      priceCoins: 10,
    });

    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const res = await request(makeApp())
      .patch(`/streamer/memes/${otherMeme.id}`)
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ title: 'Nope' });

    expect(res.status).toBe(404);
    expect(res.body?.errorCode).toBe('CHANNEL_MEME_NOT_FOUND');
  });
});
