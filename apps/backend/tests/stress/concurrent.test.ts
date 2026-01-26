import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Response } from 'express';
import type { AuthRequest } from '../../src/middleware/auth.js';
import type { Server } from 'socket.io';
import { prisma } from '../../src/lib/prisma.js';
import { activateMeme } from '../../src/services/meme/activateMeme.js';
import { WalletService } from '../../src/services/WalletService.js';
import { createSubmissionWithRepos } from '../../src/services/SubmissionService.js';
import { repositories } from '../../src/repositories/index.js';
import { emitSubmissionEvent } from '../../src/realtime/submissionBridge.js';
import { createChannel, createMeme, createUser, createWallet } from '../factories/index.js';
import { getVideoMetadata } from '../../src/utils/videoValidator.js';
import { processSubmissionUpload } from '../../src/services/submission/submissionCreateUpload.js';
import { calculateFileHash, findOrCreateFileHash, getFileStats } from '../../src/utils/fileHash.js';

vi.mock('../../src/utils/videoValidator.js', () => ({
  getVideoMetadata: vi.fn(),
}));

vi.mock('../../src/services/submission/submissionCreateUpload.js', () => ({
  processSubmissionUpload: vi.fn(),
}));

type EmitCall = { room: string; event: string; payload: unknown };

type TestResponse = {
  statusCode: number;
  body: unknown;
  headersSent: boolean;
  status: (code: number) => TestResponse;
  json: (payload: unknown) => TestResponse;
};

function createRes(): TestResponse {
  return {
    statusCode: 200,
    body: null,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
  };
}

async function writeUploadFile(dir: string, name: string, content: Buffer): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, content);
  return filePath;
}

function buildActivationRequest(params: {
  userId: string;
  userRole: string;
  channelId: string | null;
  memeId: string;
  appIoEmits: EmitCall[];
}): AuthRequest {
  const { userId, userRole, channelId, memeId, appIoEmits } = params;
  const fakeIo = {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          appIoEmits.push({ room, event, payload });
        },
      };
    },
  };
  const app = {
    get(key: string) {
      if (key === 'io') return fakeIo;
      return undefined;
    },
  };

  return {
    userId,
    userRole,
    channelId: channelId ?? undefined,
    params: { id: memeId },
    query: {},
    headers: {},
    socket: { remoteAddress: '127.0.0.1' } as unknown as AuthRequest['socket'],
    app,
  } as AuthRequest;
}

function buildSubmissionRequest(params: {
  userId: string;
  userRole: string;
  channelId: string | null;
  filePath: string;
  mimeType: string;
  fileSize: number;
  title: string;
  appIoEmits: EmitCall[];
}): AuthRequest {
  const { userId, userRole, channelId, filePath, mimeType, fileSize, title, appIoEmits } = params;
  const fileName = path.basename(filePath);
  const fakeIo = {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          appIoEmits.push({ room, event, payload });
        },
      };
    },
  };
  const app = {
    get(key: string) {
      if (key === 'io') return fakeIo;
      return undefined;
    },
  };

  return {
    userId,
    userRole,
    channelId: channelId ?? undefined,
    body: {
      channelId: channelId ?? undefined,
      title,
      type: 'video',
      tags: [],
      notes: null,
    },
    query: {},
    headers: {},
    socket: { remoteAddress: '127.0.0.1' } as unknown as AuthRequest['socket'],
    app,
    file: {
      fieldname: 'file',
      originalname: fileName,
      encoding: '7bit',
      mimetype: mimeType,
      destination: path.dirname(filePath),
      filename: fileName,
      path: filePath,
      size: fileSize,
      buffer: Buffer.alloc(0),
      stream: undefined as unknown as AuthRequest['file']['stream'],
    },
  } as AuthRequest;
}

function isSerializableConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { message?: string; meta?: { message?: string } };
  const message = String(err.message || err.meta?.message || '').toLowerCase();
  return (
    message.includes('could not serialize access') ||
    message.includes('write conflict') ||
    message.includes('deadlock')
  );
}

async function runActivationWithRetry(req: AuthRequest, maxAttempts = 3): Promise<TestResponse> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const res = createRes();
    try {
      await activateMeme(req, res as unknown as Response);
      return res;
    } catch (error) {
      lastError = error;
      if (!isSerializableConflict(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError;
}

describe('stress: concurrent operations', () => {
  const originalEnv = { ...process.env };
  let uploadDir = '';

  beforeAll(async () => {
    uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memalerts-stress-'));
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.DOMAIN = 'example.com';
    process.env.PORT = '3003';
    process.env.REDIS_URL = '';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.RATE_LIMIT_WHITELIST_IPS = '127.0.0.1,::1';
    process.env.AI_BULLMQ_ENABLED = '0';
    process.env.UPLOAD_STORAGE = 'local';
    process.env.UPLOAD_DIR = uploadDir;

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
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (uploadDir) {
      await fs.rm(uploadDir, { recursive: true, force: true });
    }
  });

  it('processes concurrent activations for the same meme without balance drift', async () => {
    const channel = await createChannel({ slug: 'stress-activation', name: 'Stress Activation' });
    const price = 25;
    const activations = 6;
    const meme = await createMeme({ channelId: channel.id, priceCoins: price, status: 'approved' });
    const viewers = await Promise.all(
      Array.from({ length: activations }, () => createUser({ role: 'viewer', channelId: null, hasBetaAccess: false }))
    );
    await Promise.all(
      viewers.map((viewer) => createWallet({ userId: viewer.id, channelId: channel.id, balance: price }))
    );

    const responses = await Promise.all(
      viewers.map((viewer) => {
        const emitted: EmitCall[] = [];
        const req = buildActivationRequest({
          userId: viewer.id,
          userRole: 'viewer',
          channelId: null,
          memeId: meme.id,
          appIoEmits: emitted,
        });
        return runActivationWithRetry(req);
      })
    );

    for (const res of responses) {
      expect(res.statusCode).toBe(200);
    }

    const wallets = await prisma.wallet.findMany({
      where: { channelId: channel.id, userId: { in: viewers.map((viewer) => viewer.id) } },
      select: { balance: true },
    });
    expect(wallets).toHaveLength(activations);
    expect(wallets.every((wallet) => wallet.balance === 0)).toBe(true);

    const activationCount = await prisma.memeActivation.count({
      where: { channelId: channel.id, channelMemeId: meme.id },
    });
    expect(activationCount).toBe(activations);
  });

  it('creates multiple submissions for the same user in parallel', async () => {
    const channel = await createChannel({ submissionsEnabled: true, submissionsOnlyWhenLive: false });
    await createUser({ role: 'streamer', channelId: channel.id });
    const viewer = await createUser({ role: 'viewer', channelId: null });
    const submissionCount = 6;

    const mp4Header = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const files = await Promise.all(
      Array.from({ length: submissionCount }, async (_item, idx) => {
        const content = Buffer.concat([mp4Header, crypto.randomBytes(8)]);
        const filePath = await writeUploadFile(uploadDir, `stress-${idx}.mp4`, content);
        return { filePath, size: content.length };
      })
    );

    const results = await Promise.all(
      files.map((file, idx) => {
        const emitted: EmitCall[] = [];
        const req = buildSubmissionRequest({
          userId: viewer.id,
          userRole: 'viewer',
          channelId: channel.id,
          filePath: file.filePath,
          mimeType: 'video/mp4',
          fileSize: file.size,
          title: `Stress ${idx}`,
          appIoEmits: emitted,
        });
        const res = createRes();
        return createSubmissionWithRepos(repositories, req, res as unknown as Response).then(() => res);
      })
    );

    for (const res of results) {
      expect(res.statusCode).toBe(201);
      expect((res.body as { id?: string })?.id).toBeTruthy();
    }

    const submissionTotal = await prisma.memeSubmission.count({
      where: { channelId: channel.id, submitterUserId: viewer.id },
    });
    expect(submissionTotal).toBe(submissionCount);
  });

  it('keeps wallet operations consistent under concurrent load', async () => {
    const channel = await createChannel();
    const viewer = await createUser({ role: 'viewer', channelId: null });
    const initialBalance = 1000;
    const ops = 40;
    const delta = 5;

    await createWallet({ userId: viewer.id, channelId: channel.id, balance: initialBalance });

    const tasks = Array.from({ length: ops }, (_, idx) =>
      prisma.$transaction(async (tx) => {
        if (idx % 2 === 0) {
          await WalletService.incrementBalance(tx, { userId: viewer.id, channelId: channel.id }, delta);
        } else {
          await WalletService.decrementBalance(tx, { userId: viewer.id, channelId: channel.id }, delta);
        }
      })
    );

    await Promise.all(tasks);

    const wallet = await prisma.wallet.findUnique({
      where: { userId_channelId: { userId: viewer.id, channelId: channel.id } },
      select: { balance: true },
    });
    const increments = Math.ceil(ops / 2);
    const decrements = Math.floor(ops / 2);
    const expected = initialBalance + (increments - decrements) * delta;
    expect(wallet?.balance).toBe(expected);
  });

  it('handles socket message floods without dropping events', () => {
    const calls: EmitCall[] = [];
    const io = {
      to(room: string) {
        return {
          emit(event: string, payload: unknown) {
            calls.push({ room, event, payload });
          },
        };
      },
    } as unknown as Server;

    const userIds = ['user-1', 'user-2'];
    const events = 40;
    for (let i = 0; i < events; i += 1) {
      emitSubmissionEvent(io, {
        event: 'submission:created',
        submissionId: `sub-${i}`,
        channelId: 'channel-1',
        channelSlug: 'Flood',
        userIds,
      });
    }

    const channelCalls = calls.filter((call) => call.room === 'channel:flood');
    const userCalls = calls.filter((call) => call.room.startsWith('user:'));
    expect(channelCalls).toHaveLength(events);
    expect(userCalls).toHaveLength(events * userIds.length);
  });
});
