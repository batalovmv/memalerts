import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import type { Prisma } from '@prisma/client';

import { prisma } from '../src/lib/prisma.js';
import { configureFfmpegPaths } from '../src/utils/media/configureFfmpeg.js';
import { createChannel, createChannelMeme, createMeme, createMemeAsset, createUser } from './factories/index.js';

configureFfmpegPaths();

function makeJwt(payload: Record<string, unknown>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
}

async function makeApp() {
  const { setupRoutes } = await import('../src/routes/index.js');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.set('io', { to: () => ({ emit: () => {} }) });
  setupRoutes(app);
  return app;
}

function getFfmpegPath(): string {
  const installer = ffmpegInstaller as { path?: unknown };
  const p = typeof installer.path === 'string' ? installer.path : '';
  if (!p) throw new Error('ffmpeg binary not available');
  return p;
}

function runFfmpeg(args: string[]): void {
  const ffmpegPath = getFfmpegPath();
  const res = spawnSync(ffmpegPath, args, { stdio: 'pipe' });
  if (res.status !== 0) {
    const stderr = res.stderr?.toString('utf8') || '';
    throw new Error(`ffmpeg failed: ${stderr}`);
  }
}

async function writeTmpFile(ext: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memalerts-dualwrite-'));
  return path.join(dir, `input.${ext}`);
}

async function resetUploadsDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

// Legacy dual-write paths removed in the simplified schema.
describe.skip('dual-write consistency', () => {
  const originalEnv = { ...process.env };
  let uploadRoot = '';

  beforeAll(async () => {
    uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'memalerts-uploads-'));
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'test';
    process.env.DOMAIN = 'example.com';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.UPLOAD_DIR = uploadRoot;
  });

  afterAll(async () => {
    process.env = originalEnv;
    if (uploadRoot) {
      await fs.rm(uploadRoot, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    await resetUploadsDir(uploadRoot);
  });

  it('owner auto-approve creates consistent records', async () => {
    const channel = await createChannel({
      slug: `ch_${Date.now()}`,
      name: 'Channel',
      defaultPriceCoins: 120,
    } satisfies Prisma.ChannelCreateInput);
    const streamer = await createUser({
      displayName: 'Streamer',
      role: 'streamer',
      hasBetaAccess: false,
      channelId: channel.id,
    });

    const inputPath = await writeTmpFile('mp4');
    runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x240:rate=30',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=1000:sample_rate=44100',
      '-t',
      '1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      inputPath,
    ]);

    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = await makeApp();
    const res = await request(app)
      .post('/submissions')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .set('Host', 'example.com')
      .field('type', 'video')
      .field('title', 'Owner upload')
      .field('channelId', channel.id)
      .attach('file', inputPath, { contentType: 'video/mp4' });

    expect(res.status).toBe(201);
    expect(res.body?.channelMemeId).toBeTruthy();
    expect(res.body?.memeAssetId).toBeTruthy();
    expect(res.body?.id).toBeTruthy();

    const channelMeme = await prisma.channelMeme.findUnique({
      where: { id: res.body.channelMemeId },
      select: { id: true, memeAssetId: true, legacyMemeId: true, status: true, deletedAt: true },
    });
    const memeAsset = await prisma.memeAsset.findUnique({
      where: { id: res.body.memeAssetId },
      select: { id: true },
    });
    const legacy = await prisma.meme.findUnique({
      where: { id: res.body.id },
      select: { id: true },
    });

    expect(channelMeme?.memeAssetId).toBe(memeAsset?.id);
    expect(channelMeme?.legacyMemeId).toBe(legacy?.id);
    expect(channelMeme?.status).toBe('approved');
    expect(channelMeme?.deletedAt).toBeNull();
  });

  it('simulated dual-write failure rolls back', async () => {
    const channel = await createChannel({
      slug: `ch_${Date.now()}`,
      name: 'Channel',
      defaultPriceCoins: 100,
    } satisfies Prisma.ChannelCreateInput);
    const streamer = await createUser({
      displayName: 'Streamer',
      role: 'streamer',
      hasBetaAccess: false,
      channelId: channel.id,
    });
    const asset = await createMemeAsset({
      type: 'video',
      fileUrl: `/uploads/pool/${Date.now()}.mp4`,
      durationMs: 1000,
    });

    process.env.DUAL_WRITE_FAIL_STEP = 'createPoolSubmission:afterLegacy';
    try {
      const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
      const app = await makeApp();
      const res = await request(app)
        .post('/submissions/pool')
        .set('Cookie', [`token=${encodeURIComponent(token)}`])
        .set('Host', 'example.com')
        .send({ channelId: channel.id, memeAssetId: asset.id, title: 'Pool adopt' });

      expect(res.status).toBe(500);

      const channelMemes = await prisma.channelMeme.findMany({
        where: { channelId: channel.id, memeAssetId: asset.id },
        select: { id: true },
      });
      const legacyMemes = await prisma.meme.findMany({
        where: { channelId: channel.id, fileUrl: asset.fileUrl },
        select: { id: true },
      });

      expect(channelMemes.length).toBe(0);
      expect(legacyMemes.length).toBe(0);
    } finally {
      delete process.env.DUAL_WRITE_FAIL_STEP;
    }
  });

  it('delete keeps legacy meme in sync', async () => {
    const channel = await createChannel({
      slug: `ch_${Date.now()}`,
      name: 'Channel',
      defaultPriceCoins: 100,
    } satisfies Prisma.ChannelCreateInput);
    const streamer = await createUser({
      displayName: 'Streamer',
      role: 'streamer',
      hasBetaAccess: false,
      channelId: channel.id,
    });
    const assetFileUrl = `/uploads/memes/${Date.now()}.mp4`;
    const asset = await createMemeAsset({
      type: 'video',
      fileUrl: assetFileUrl,
      durationMs: 1000,
    });
    const legacy = await createMeme({
      channelId: channel.id,
      title: 'Legacy meme',
      type: 'video',
      fileUrl: assetFileUrl,
      durationMs: 1000,
      priceCoins: 100,
      status: 'approved',
    } satisfies Prisma.MemeCreateInput);
    const channelMeme = await createChannelMeme({
      channelId: channel.id,
      memeAssetId: asset.id,
      legacyMemeId: legacy.id,
      title: 'Channel meme',
      priceCoins: 100,
      status: 'approved',
    } satisfies Prisma.ChannelMemeCreateInput);

    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const app = await makeApp();
    const res = await request(app)
      .delete(`/streamer/memes/${channelMeme.id}`)
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .set('Host', 'example.com');

    expect(res.status).toBe(200);

    const updatedCm = await prisma.channelMeme.findUnique({
      where: { id: channelMeme.id },
      select: { status: true, deletedAt: true, legacyMemeId: true },
    });
    const updatedLegacy = await prisma.meme.findUnique({
      where: { id: legacy.id },
      select: { status: true, deletedAt: true },
    });

    expect(updatedCm?.status).toBe('disabled');
    expect(updatedCm?.deletedAt).not.toBeNull();
    expect(updatedLegacy?.status).toBe('deleted');
    expect(updatedLegacy?.deletedAt).not.toBeNull();
    expect(updatedCm?.legacyMemeId).toBe(legacy.id);
  });

  it('audit:consistency exits non-zero on mismatch', async () => {
    const channel = await createChannel({
      slug: `ch_${Date.now()}`,
      name: 'Channel',
      defaultPriceCoins: 100,
    } satisfies Prisma.ChannelCreateInput);
    await createMeme({
      channelId: channel.id,
      title: 'Orphan legacy',
      type: 'video',
      fileUrl: `/uploads/memes/${Date.now()}.mp4`,
      durationMs: 1000,
      priceCoins: 100,
      status: 'approved',
    } satisfies Prisma.MemeCreateInput);

    const pnpmCmd = process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'npm', 'pnpm.cmd') : 'pnpm';
    const pnpmExec = process.platform === 'win32' && existsSync(pnpmCmd) ? pnpmCmd : 'pnpm';
    const res = spawnSync(pnpmExec, ['-s', 'audit:consistency'], {
      cwd: path.resolve(process.cwd()),
      env: { ...process.env },
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });

    expect(res.status).not.toBe(0);
    const combined = `${res.stdout || ''}\n${res.stderr || ''}`;
    expect(combined).toContain('legacyMeme_missing_channelMeme');
  });
});
