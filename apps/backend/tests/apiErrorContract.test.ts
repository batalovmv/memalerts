import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import rateLimit from 'express-rate-limit';

import { configureFfmpegPaths } from '../src/utils/media/configureFfmpeg.js';
import { requestContext } from '../src/middleware/requestContext.js';
import { errorResponseFormat } from '../src/middleware/errorResponseFormat.js';
import { csrfProtection } from '../src/middleware/csrf.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { createChannel, createUser } from './factories/index.js';

configureFfmpegPaths();

function rand(): string {
  return Math.random().toString(16).slice(2);
}

function makeJwt(payload: Record<string, unknown>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
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

async function writeTmpFile(name: string, content: Buffer): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memalerts-err-'));
  const p = path.join(dir, name);
  await fs.writeFile(p, content);
  return p;
}

async function resetUploadsDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function makeApiApp() {
  const { setupRoutes } = await import('../src/routes/index.js');
  const app = express();
  app.use(requestContext);
  app.use(errorResponseFormat);
  app.use(express.json());
  app.use(cookieParser());
  app.use(csrfProtection);
  app.set('io', { to: () => ({ emit: () => {} }) });
  setupRoutes(app);
  app.use(errorHandler);
  return app;
}

function expectErrorShape(body: unknown) {
  const payload = body as Record<string, unknown>;
  expect(payload).toBeTruthy();
  expect(typeof payload.error).toBe('string');
  expect(typeof payload.errorCode).toBe('string');
  expect(typeof payload.requestId).toBe('string');
  expect(payload.traceId === null || typeof payload.traceId === 'string').toBe(true);
}

describe('API error contract (shape + errorCode + requestId)', () => {
  const originalEnv = { ...process.env };
  let uploadRoot = '';

  beforeAll(async () => {
    uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'memalerts-uploads-err-'));
  });

  beforeEach(async () => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.DOMAIN = 'example.com';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.UPLOAD_DIR = uploadRoot;
    await resetUploadsDir(uploadRoot);
  });

  afterAll(async () => {
    process.env = originalEnv;
    if (uploadRoot) await fs.rm(uploadRoot, { recursive: true, force: true });
  });

  it('unauthorized endpoint returns 401 + UNAUTHORIZED + requestId', async () => {
    const app = await makeApiApp();
    const res = await request(app).get('/me').set('Host', 'example.com');
    expect(res.status).toBe(401);
    expect(res.body?.errorCode).toBe('UNAUTHORIZED');
    expectErrorShape(res.body);
  });

  it('CSRF failure returns 403 + CSRF_INVALID + requestId', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '3001';
    process.env.DOMAIN = 'example.com';
    process.env.WEB_URL = 'https://example.com';

    const app = await makeApiApp();
    const res = await request(app).post('/auth/logout').set('Origin', 'https://evil.com').send({});
    expect(res.status).toBe(403);
    expect(res.body?.errorCode).toBe('CSRF_INVALID');
    expectErrorShape(res.body);
  });

  it('upload wrong type returns 400 + INVALID_FILE_TYPE + requestId', async () => {
    const channel = await createChannel({
      slug: `ch_${rand()}`,
      name: `Channel ${rand()}`,
      defaultPriceCoins: 100,
    });
    const viewer = await createUser({
      displayName: `Viewer ${rand()}`,
      role: 'viewer',
      hasBetaAccess: false,
      channelId: null,
    });

    const token = makeJwt({ userId: viewer.id, role: 'viewer', channelId: null });
    const txt = await writeTmpFile('file.txt', Buffer.from('hello'));
    const app = await makeApiApp();
    const res = await request(app)
      .post('/submissions')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .set('Host', 'example.com')
      .field('type', 'video')
      .field('title', 'Bad type')
      .field('channelId', channel.id)
      .attach('file', txt, { contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(res.body?.errorCode).toBe('INVALID_FILE_TYPE');
    expectErrorShape(res.body);
  });

  it('upload invalid content returns 400 + INVALID_FILE_CONTENT + requestId', async () => {
    const channel = await createChannel({
      slug: `ch_${rand()}`,
      name: `Channel ${rand()}`,
      defaultPriceCoins: 100,
    });
    const viewer = await createUser({
      displayName: `Viewer ${rand()}`,
      role: 'viewer',
      hasBetaAccess: false,
      channelId: null,
    });

    const token = makeJwt({ userId: viewer.id, role: 'viewer', channelId: null });
    const fake = await writeTmpFile('file.mp4', Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x11]));
    const app = await makeApiApp();
    const res = await request(app)
      .post('/submissions')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .set('Host', 'example.com')
      .field('type', 'video')
      .field('title', 'Bad content')
      .field('channelId', channel.id)
      .attach('file', fake, { contentType: 'video/mp4' });

    expect(res.status).toBe(400);
    expect(res.body?.errorCode).toBe('INVALID_FILE_CONTENT');
    expectErrorShape(res.body);
  });

  it('upload too large returns 413 + FILE_TOO_LARGE + requestId', async () => {
    process.env.MAX_FILE_SIZE = '10';

    const channel = await createChannel({
      slug: `ch_${rand()}`,
      name: `Channel ${rand()}`,
      defaultPriceCoins: 100,
    });
    const viewer = await createUser({
      displayName: `Viewer ${rand()}`,
      role: 'viewer',
      hasBetaAccess: false,
      channelId: null,
    });

    const token = makeJwt({ userId: viewer.id, role: 'viewer', channelId: null });
    const big = await writeTmpFile('big.mp4', Buffer.alloc(20, 0x41));
    const app = await makeApiApp();
    const res = await request(app)
      .post('/submissions')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .set('Host', 'example.com')
      .field('type', 'video')
      .field('title', 'Too big')
      .field('channelId', channel.id)
      .attach('file', big, { contentType: 'video/mp4' });

    expect(res.status).toBe(413);
    expect(res.body?.errorCode).toBe('FILE_TOO_LARGE');
    expectErrorShape(res.body);
  });

  it('upload too long returns 413 + VIDEO_TOO_LONG + requestId', async () => {
    const channel = await createChannel({
      slug: `ch_${rand()}`,
      name: `Channel ${rand()}`,
      defaultPriceCoins: 100,
    });
    const viewer = await createUser({
      displayName: `Viewer ${rand()}`,
      role: 'viewer',
      hasBetaAccess: false,
      channelId: null,
    });

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memalerts-too-long-'));
    const inputPath = path.join(dir, 'long.mp4');
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
      '16',
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

    const token = makeJwt({ userId: viewer.id, role: 'viewer', channelId: null });
    const app = await makeApiApp();
    const res = await request(app)
      .post('/submissions')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .set('Host', 'example.com')
      .field('type', 'video')
      .field('title', 'Too long')
      .field('channelId', channel.id)
      .attach('file', inputPath, { contentType: 'video/mp4' });

    expect(res.status).toBe(413);
    expect(res.body?.errorCode).toBe('VIDEO_TOO_LONG');
    expectErrorShape(res.body);
  });

  it('rate limit returns 429 + RATE_LIMITED + requestId', async () => {
    const app = express();
    app.use(requestContext);
    app.use(errorResponseFormat);
    app.use(
      rateLimit({
        windowMs: 60_000,
        max: 1,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (_req, res) => res.status(429).json({ errorCode: 'RATE_LIMITED', error: 'Too many requests' }),
      })
    );
    app.get('/limited', (_req, res) => res.status(200).json({ ok: true }));
    app.use(errorHandler);

    const r1 = await request(app).get('/limited');
    expect(r1.status).toBe(200);

    const r2 = await request(app).get('/limited');
    expect(r2.status).toBe(429);
    expect(r2.body?.errorCode).toBe('RATE_LIMITED');
    expectErrorShape(r2.body);
  });
});

