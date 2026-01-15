import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import type { Prisma } from '@prisma/client';

import { prisma } from '../src/lib/prisma.js';
import { calculateFileHash } from '../src/utils/fileHash.js';
import { configureFfmpegPaths } from '../src/utils/media/configureFfmpeg.js';
import { createChannel, createUser } from './factories/index.js';

configureFfmpegPaths();

function rand(): string {
  return Math.random().toString(16).slice(2);
}

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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memalerts-video-'));
  return path.join(dir, `input.${ext}`);
}

function probeVideo(filePath: string): { videoCodec?: string; audioCodec?: string; durationSec?: number } {
  const ffmpegPath = getFfmpegPath();
  const res = spawnSync(ffmpegPath, ['-hide_banner', '-i', filePath, '-f', 'null', '-'], { encoding: 'utf8' });
  const output = String(res.stderr || '');
  const videoMatch = output.match(/Video:\s*([^ ,]+)/);
  const audioMatch = output.match(/Audio:\s*([^ ,]+)/);
  const durMatch = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  let durationSec: number | undefined;
  if (durMatch) {
    const h = Number(durMatch[1]);
    const m = Number(durMatch[2]);
    const s = Number(durMatch[3]);
    if (Number.isFinite(h) && Number.isFinite(m) && Number.isFinite(s)) {
      durationSec = h * 3600 + m * 60 + s;
    }
  }
  return {
    videoCodec: videoMatch ? String(videoMatch[1]).toLowerCase() : undefined,
    audioCodec: audioMatch ? String(audioMatch[1]).toLowerCase() : undefined,
    durationSec,
  };
}

function publicToLocal(publicPath: string, uploadsRoot: string): string {
  if (!publicPath.startsWith('/uploads/')) {
    throw new Error(`Unexpected public path: ${publicPath}`);
  }
  const rel = publicPath.replace(/^\/uploads\//, '');
  return path.resolve(uploadsRoot, rel);
}

async function resetUploadsDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

describe('video normalization on upload', () => {
  const originalEnv = { ...process.env };
  let uploadRoot = '';

  beforeAll(async () => {
    uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'memalerts-uploads-'));
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
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

  it('AVI/MKV -> MP4', async () => {
    const channel = await createChannel({
      slug: `ch_${rand()}`,
      name: `Channel ${rand()}`,
      defaultPriceCoins: 100,
    } satisfies Prisma.ChannelCreateInput);
    const viewer = await createUser({
      displayName: `Viewer ${rand()}`,
      role: 'viewer',
      hasBetaAccess: false,
      channelId: null,
    });

    const inputPath = await writeTmpFile('mkv');
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
      '2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-f',
      'matroska',
      inputPath,
    ]);

    const token = makeJwt({ userId: viewer.id, role: 'viewer', channelId: null });
    const app = await makeApp();
    const res = await request(app)
      .post('/submissions')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .set('Host', 'example.com')
      .field('type', 'video')
      .field('title', 'Test mkv')
      .field('channelId', channel.id)
      .attach('file', inputPath, { contentType: 'video/x-matroska' });

    expect(res.status).toBe(201);
    expect(res.body?.mimeType).toBe('video/mp4');
    const publicPath = String(res.body?.fileUrlTemp || '');
    expect(publicPath.startsWith('/uploads/')).toBe(true);

    const localPath = publicToLocal(publicPath, uploadRoot);
    const probe = probeVideo(localPath);
    expect(probe.videoCodec).toBe('h264');
    expect(probe.audioCodec).toBe('aac');
    expect(Number(probe.durationSec || 0)).toBeLessThanOrEqual(15);
  });

  it('Already OK -> no transcode', async () => {
    const channel = await createChannel({
      slug: `ch_${rand()}`,
      name: `Channel ${rand()}`,
      defaultPriceCoins: 100,
    } satisfies Prisma.ChannelCreateInput);
    const viewer = await createUser({
      displayName: `Viewer ${rand()}`,
      role: 'viewer',
      hasBetaAccess: false,
      channelId: null,
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
      '2',
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

    const originalHash = await calculateFileHash(inputPath);

    const token = makeJwt({ userId: viewer.id, role: 'viewer', channelId: null });
    const app = await makeApp();
    const res = await request(app)
      .post('/submissions')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .set('Host', 'example.com')
      .field('type', 'video')
      .field('title', 'Test mp4')
      .field('channelId', channel.id)
      .attach('file', inputPath, { contentType: 'video/mp4' });

    expect(res.status).toBe(201);
    const publicPath = String(res.body?.fileUrlTemp || '');
    const localPath = publicToLocal(publicPath, uploadRoot);
    const storedHash = await calculateFileHash(localPath);
    expect(storedHash).toBe(originalHash);
  });

  it('Transcode fails -> cleanup', async () => {
    const channel = await createChannel({
      slug: `ch_${rand()}`,
      name: `Channel ${rand()}`,
      defaultPriceCoins: 100,
    } satisfies Prisma.ChannelCreateInput);
    const viewer = await createUser({
      displayName: `Viewer ${rand()}`,
      role: 'viewer',
      hasBetaAccess: false,
      channelId: null,
    });

    const badPath = await writeTmpFile('mp4');
    const fakeMp4 = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    await fs.writeFile(badPath, fakeMp4);

    const beforeCount = await prisma.fileHash.count();

    const token = makeJwt({ userId: viewer.id, role: 'viewer', channelId: null });
    const app = await makeApp();
    const res = await request(app)
      .post('/submissions')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .set('Host', 'example.com')
      .field('type', 'video')
      .field('title', 'Bad mp4')
      .field('channelId', channel.id)
      .attach('file', badPath, { contentType: 'video/mp4' });

    expect(res.status).toBe(422);
    const afterCount = await prisma.fileHash.count();
    expect(afterCount).toBe(beforeCount);

    const remaining = await fs.readdir(uploadRoot);
    expect(remaining.length).toBe(0);
  });
});
