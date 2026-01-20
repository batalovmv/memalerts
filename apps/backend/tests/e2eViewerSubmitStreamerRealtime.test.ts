import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket } from 'socket.io-client';
import { spawnSync } from 'node:child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

import { requestContext } from '../src/middleware/requestContext.js';
import { errorResponseFormat } from '../src/middleware/errorResponseFormat.js';
import { csrfProtection } from '../src/middleware/csrf.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { setupRoutes } from '../src/routes/index.js';
import { setupSocketIO } from '../src/socket/index.js';
import { configureFfmpegPaths } from '../src/utils/media/configureFfmpeg.js';

configureFfmpegPaths();

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

async function writeTempMp4(seconds = 2): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memalerts-e2e-'));
  const out = path.join(dir, `upload_${Date.now()}.mp4`);
  // Deterministic small video: color bars + silent audio track.
  runFfmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc=size=320x240:rate=25`,
    '-f',
    'lavfi',
    '-i',
    'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-t',
    String(seconds),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'veryfast',
    '-movflags',
    '+faststart',
    '-c:a',
    'aac',
    out,
  ]);
  return out;
}

async function resetDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

function cookiePairFromSetCookie(setCookie: string[] | undefined, name: string): string {
  const raw = (setCookie || []).find((c) => c.startsWith(`${name}=`));
  if (!raw) throw new Error(`Missing Set-Cookie for ${name}`);
  return raw.split(';')[0]!;
}

async function makeE2eServer() {
  const app = express();
  app.use(requestContext);
  app.use(errorResponseFormat);
  app.use(express.json());
  app.use(cookieParser());
  app.use(csrfProtection);

  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*', credentials: true } });
  setupSocketIO(io);
  app.set('io', io);

  setupRoutes(app);
  app.use(errorHandler);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const addr = httpServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  if (!port) throw new Error('Failed to listen on a port');

  return {
    app,
    httpServer,
    io,
    port,
    close: async () => {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

describe('E2E: viewer submits meme (multipart) -> streamer receives realtime update', () => {
  const originalEnv = { ...process.env };
  let uploadRoot = '';

  beforeAll(async () => {
    uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'memalerts-uploads-e2e-'));
  });

  beforeEach(async () => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
    process.env.DOMAIN = 'example.com';
    process.env.WEB_URL = 'https://example.com';
    process.env.UPLOAD_DIR = uploadRoot;
    process.env.UPLOAD_STORAGE = 'local';
    await resetDir(uploadRoot);
  });

  afterAll(async () => {
    process.env = originalEnv;
    if (uploadRoot) await fs.rm(uploadRoot, { recursive: true, force: true });
  });

  it('passes CSRF Origin check for multipart upload, creates submission, and emits submission:created', async () => {
    const { app, port, close } = await makeE2eServer();
    const origin = 'https://example.com';

    // 1) Deterministic logins (no external OAuth)
    const streamerLogin = await request(app)
      .post('/test/login')
      .set('Origin', origin)
      .send({ role: 'streamer', channelSlug: 'e2e-channel' });
    expect(streamerLogin.status).toBe(200);
    const streamerCookie = cookiePairFromSetCookie(streamerLogin.header['set-cookie'], 'token');
    const channelId = streamerLogin.body?.channel?.id as string;
    const channelSlug = streamerLogin.body?.channel?.slug as string;
    expect(channelId).toBeTruthy();
    expect(channelSlug).toBeTruthy();

    const viewerLogin = await request(app).post('/test/login').set('Origin', origin).send({ role: 'viewer' });
    expect(viewerLogin.status).toBe(200);
    const viewerCookie = cookiePairFromSetCookie(viewerLogin.header['set-cookie'], 'token');

    // 2) Streamer connects via Socket.IO and joins channel room (auth cookie in handshake)
    const streamerSocket: Socket = ioClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      extraHeaders: { Cookie: streamerCookie },
    });

    type SubmissionCreatedPayload = { submissionId: string; channelId: string };
    const gotEvent = new Promise<SubmissionCreatedPayload>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timed out waiting for submission:created')), 8000);
      streamerSocket.on('connect_error', (e) => {
        clearTimeout(t);
        reject(e);
      });
      streamerSocket.on('submission:created', (payload: SubmissionCreatedPayload) => {
        clearTimeout(t);
        resolve(payload);
      });
    });

    await new Promise<void>((resolve, reject) => {
      streamerSocket.once('connect', () => resolve());
      streamerSocket.once('connect_error', (e) => reject(e));
    });
    streamerSocket.emit('join:channel', channelSlug);

    // 3) Viewer submits multipart/form-data upload with explicit Origin (CSRF) + cookie (auth)
    const mp4Path = await writeTempMp4(2);
    const title = `e2e_${Date.now()}`;

    const submitRes = await request(app)
      .post('/submissions')
      .set('Origin', origin)
      .set('Cookie', [viewerCookie])
      .field('channelId', channelId)
      .field('type', 'video')
      .field('title', title)
      .attach('file', mp4Path, { contentType: 'video/mp4' });

    expect(submitRes.status).toBe(201);
    expect(submitRes.body?.id).toBeTruthy();
    expect(submitRes.body?.channelId).toBe(channelId);

    // 4) Streamer receives realtime update
    const evt = await gotEvent;
    expect(evt.channelId).toBe(channelId);
    expect(evt.submissionId).toBe(submitRes.body.id);

    // 5) Viewer can see the submission in "mine"
    const mineRes = await request(app).get('/submissions/mine').set('Cookie', [viewerCookie]);
    expect(mineRes.status).toBe(200);
    expect(Array.isArray(mineRes.body?.items)).toBe(true);
    const mineItems = Array.isArray(mineRes.body?.items)
      ? (mineRes.body.items as Array<{ id: string; title: string }>)
      : [];
    expect(mineItems.some((s) => s.id === submitRes.body.id && s.title === title)).toBe(true);

    streamerSocket.disconnect();
    await close();
  });
});
