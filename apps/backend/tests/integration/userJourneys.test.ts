import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/videoValidator.js', () => ({
  getVideoMetadata: vi.fn(),
}));
vi.mock('../../src/services/submission/submissionCreateUpload.js', () => ({
  processSubmissionUpload: vi.fn(),
}));

import { setupRoutes } from '../../src/routes/index.js';
import { prisma } from '../../src/lib/prisma.js';
import { getVideoMetadata } from '../../src/utils/videoValidator.js';
import { processSubmissionUpload } from '../../src/services/submission/submissionCreateUpload.js';
import { createChannel, createChannelMeme, createMeme, createMemeAsset, createWallet } from '../factories/index.js';
import { calculateFileHash, findOrCreateFileHash, getFileStats } from '../../src/utils/fileHash.js';

type LoginResult = {
  cookie: string;
  userId: string;
  channelId: string | null;
  channelSlug: string | null;
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.set('io', { to: () => ({ emit: () => {} }) });
  setupRoutes(app);
  return app;
}

function cookiePairFromSetCookie(setCookie: string[] | undefined, name: string): string {
  const raw = (setCookie || []).find((c) => c.startsWith(`${name}=`));
  if (!raw) throw new Error(`Missing Set-Cookie for ${name}`);
  return raw.split(';')[0]!;
}

async function login(app: express.Express, role: string, channelSlug?: string): Promise<LoginResult> {
  const res = await request(app).post('/test/login').set('Host', 'example.com').send({ role, channelSlug });
  expect(res.status).toBe(200);
  const cookie = cookiePairFromSetCookie(res.header['set-cookie'], 'token');
  return {
    cookie,
    userId: res.body?.user?.id,
    channelId: res.body?.channel?.id ?? null,
    channelSlug: res.body?.channel?.slug ?? null,
  };
}

async function writeTempMp4(uploadRoot: string, name: string): Promise<string> {
  const filePath = path.join(uploadRoot, name);
  const mp4Header = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  await fs.writeFile(filePath, mp4Header);
  return filePath;
}

async function resetDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

describe('integration user journeys', () => {
  const originalEnv = { ...process.env };
  let uploadRoot = '';

  beforeAll(async () => {
    uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'memalerts-uploads-'));
  });

  beforeEach(async () => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'test';
    process.env.DOMAIN = 'example.com';
    process.env.PORT = '3001';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.REDIS_URL = '';
    process.env.AI_BULLMQ_ENABLED = '0';
    process.env.CHAT_OUTBOX_BULLMQ_ENABLED = '0';
    process.env.UPLOAD_STORAGE = 'local';
    process.env.UPLOAD_DIR = uploadRoot;
    process.env.RATE_LIMIT_WHITELIST_IPS = '127.0.0.1,::1';
    await resetDir(uploadRoot);

    vi.mocked(getVideoMetadata).mockResolvedValue({ duration: 5, size: 1024 });
    vi.mocked(processSubmissionUpload).mockImplementation(async ({ req }) => {
      const hash = await calculateFileHash(req.file.path);
      const stats = await getFileStats(req.file.path);
      const result = await findOrCreateFileHash(req.file.path, hash, stats.mimeType, stats.size);
      return {
        finalFilePath: result.filePath,
        fileHash: hash,
        contentHash: null,
        normalizedMimeType: stats.mimeType,
        normalizedSizeBytes: Number(stats.size),
        effectiveDurationMs: 5000,
        tempFileForCleanup: null,
        fileHashForCleanup: hash,
        fileHashRefAdded: true,
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    process.env = originalEnv;
    if (uploadRoot) {
      await fs.rm(uploadRoot, { recursive: true, force: true });
    }
  });

  it('viewer logs in, browses channel, and activates a meme', async () => {
    const app = makeApp();
    const channel = await createChannel({ slug: 'journey-viewer', name: 'Journey Viewer', defaultPriceCoins: 100 });
    const asset = await createMemeAsset({ fileUrl: '/uploads/memes/journey.webm', durationMs: 1000 });
    const channelMeme = await createChannelMeme({
      channelId: channel.id,
      memeAssetId: asset.id,
      title: 'Journey Meme',
      priceCoins: 100,
      status: 'approved',
    });

    const viewerLogin = await login(app, 'viewer');
    await createWallet({ userId: viewerLogin.userId, channelId: channel.id, balance: 500 });

    const browseRes = await request(app)
      .get(`/public/channels/${channel.slug}?includeMemes=true`)
      .set('Host', 'example.com');
    expect(browseRes.status).toBe(200);
    expect(browseRes.body.memes.some((m: { channelMemeId: string }) => m.channelMemeId === channelMeme.id)).toBe(true);

    const activateRes = await request(app)
      .post(`/memes/${channelMeme.id}/activate`)
      .set('Cookie', [viewerLogin.cookie])
      .set('Host', 'example.com')
      .send({ channelId: channel.id });
    expect(activateRes.status).toBe(200);
    expect(activateRes.body?.activation?.status).toBe('queued');

    const wallet = await prisma.wallet.findUnique({
      where: { userId_channelId: { userId: viewerLogin.userId, channelId: channel.id } },
      select: { balance: true },
    });
    expect(wallet?.balance).toBe(400);
  });

  it('streamer logs in, uploads a meme, and updates channel settings', async () => {
    const app = makeApp();
    const streamerLogin = await login(app, 'streamer', 'journey-streamer');
    const uploadPath = await writeTempMp4(uploadRoot, 'streamer.mp4');

    const submitRes = await request(app)
      .post('/submissions')
      .set('Host', 'example.com')
      .set('Cookie', [streamerLogin.cookie])
      .field('channelId', streamerLogin.channelId)
      .field('type', 'video')
      .field('title', 'Streamer Upload')
      .attach('file', uploadPath, { contentType: 'video/mp4' });

    expect(submitRes.status).toBe(201);
    expect(submitRes.body?.status).toBe('approved');

    const settingsRes = await request(app)
      .patch('/streamer/channel/settings')
      .set('Host', 'example.com')
      .set('Cookie', [streamerLogin.cookie])
      .send({ submissionsEnabled: true, primaryColor: '#112233' });

    expect(settingsRes.status).toBe(200);
    expect(settingsRes.body?.submissionsEnabled).toBe(true);
    expect(settingsRes.body?.primaryColor).toBe('#112233');
  });

  it('viewer submits, streamer approves, and meme appears publicly', async () => {
    const app = makeApp();
    const streamerLogin = await login(app, 'streamer', 'journey-approval');
    const viewerLogin = await login(app, 'viewer');
    const uploadPath = await writeTempMp4(uploadRoot, 'viewer.mp4');

    const submitRes = await request(app)
      .post('/submissions')
      .set('Host', 'example.com')
      .set('Cookie', [viewerLogin.cookie])
      .field('channelId', streamerLogin.channelId)
      .field('type', 'video')
      .field('title', 'Viewer Submission')
      .attach('file', uploadPath, { contentType: 'video/mp4' });

    expect(submitRes.status).toBe(201);
    expect(submitRes.body?.status).toBe('pending');

    const approveRes = await request(app)
      .post(`/streamer/submissions/${submitRes.body.id}/approve`)
      .set('Host', 'example.com')
      .set('Cookie', [streamerLogin.cookie])
      .send({});
    expect(approveRes.status).toBe(200);

    const listRes = await request(app)
      .get(`/public/channels/${streamerLogin.channelSlug}?includeMemes=true`)
      .set('Host', 'example.com');
    expect(listRes.status).toBe(200);
    expect(listRes.body.memes.some((m: { title: string }) => m.title === 'Viewer Submission')).toBe(true);
  });
});
