import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import type { Response } from 'express';
import type { AuthRequest } from '../src/middleware/auth.js';
import { prisma } from '../src/lib/prisma.js';
import { repositories } from '../src/repositories/index.js';
import { createSubmissionWithRepos } from '../src/services/SubmissionService.js';
import { processSubmissionUpload } from '../src/services/submission/submissionCreateUpload.js';
import { createChannel, createUser } from './factories/index.js';
import { getVideoMetadata } from '../src/utils/videoValidator.js';
import { calculateFileHash, findOrCreateFileHash, getFileStats } from '../src/utils/fileHash.js';

vi.mock('../src/utils/videoValidator.js', () => ({
  getVideoMetadata: vi.fn(),
}));

vi.mock('../src/services/submission/submissionCreateUpload.js', () => ({
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

async function writeTempFile(buf: Buffer, name: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memalerts-submission-'));
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, buf);
  return filePath;
}

function buildRequest(params: {
  userId: string;
  userRole: string;
  channelId: string | null;
  filePath: string;
  mimeType: string;
  fileSize: number;
  title: string;
  tags?: string[];
  notes?: string | null;
  idempotencyKey?: string;
  appIoEmits: EmitCall[];
}): AuthRequest {
  const {
    userId,
    userRole,
    channelId,
    filePath,
    mimeType,
    fileSize,
    title,
    tags = [],
    notes = null,
    idempotencyKey,
    appIoEmits,
  } = params;
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
    idempotencyKey,
    body: {
      channelId: channelId ?? undefined,
      title,
      type: 'video',
      tags,
      notes,
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

describe('submission create flow', () => {
  const originalEnv = { ...process.env };
  let uploadDir: string;

  beforeAll(async () => {
    uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memalerts-uploads-'));
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.DOMAIN = 'example.com';
    process.env.PORT = '3003';
    process.env.REDIS_URL = '';
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

  afterAll(async () => {
    process.env = originalEnv;
    if (uploadDir) {
      await fs.rm(uploadDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a pending submission for viewers and emits events', async () => {
    const channel = await createChannel({ submissionsEnabled: true, submissionsOnlyWhenLive: false });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const viewer = await createUser({ role: 'viewer', channelId: null });

    const mp4Header = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const filePath = await writeTempFile(mp4Header, 'test.mp4');

    const emitted: EmitCall[] = [];
    const req = buildRequest({
      userId: viewer.id,
      userRole: 'viewer',
      channelId: channel.id,
      filePath,
      mimeType: 'video/mp4',
      fileSize: mp4Header.length,
      title: 'Funny Cat',
      tags: ['funny', 'cat'],
      appIoEmits: emitted,
    });
    const res = createRes();

    await createSubmissionWithRepos(repositories, req, res as unknown as Response);

    expect(res.statusCode).toBe(201);
    const submissionId = (res.body as { id?: string })?.id;
    expect(typeof submissionId).toBe('string');

    const submission = await prisma.memeSubmission.findUnique({
      where: { id: submissionId! },
      include: { tags: { include: { tag: true } } },
    });
    expect(submission?.status).toBe('pending');
    const tagNames = submission?.tags.map((t) => t.tag.name).sort();
    expect(tagNames).toEqual(['cat', 'funny']);

    const channelRoom = `channel:${channel.slug.toLowerCase()}`;
    const userRoom = `user:${streamer.id}`;
    expect(emitted.some((e) => e.room === channelRoom && e.event === 'submission:created')).toBe(true);
    expect(emitted.some((e) => e.room === userRoom && e.event === 'submission:created')).toBe(true);
  });

  it('auto-approves submissions from the channel owner', async () => {
    const channel = await createChannel({ submissionsEnabled: true, submissionsOnlyWhenLive: false });
    const owner = await createUser({ role: 'streamer', channelId: channel.id });

    const mp4Header = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const filePath = await writeTempFile(mp4Header, 'owner.mp4');

    vi.mocked(processSubmissionUpload).mockImplementationOnce(async ({ res }) => {
      res.status(400).json({ errorCode: 'INVALID_FILE_CONTENT' });
      return null;
    });

    const emitted: EmitCall[] = [];
    const req = buildRequest({
      userId: owner.id,
      userRole: 'streamer',
      channelId: channel.id,
      filePath,
      mimeType: 'video/mp4',
      fileSize: mp4Header.length,
      title: 'Owner Meme',
      appIoEmits: emitted,
    });
    const res = createRes();

    await createSubmissionWithRepos(repositories, req, res as unknown as Response);

    expect(res.statusCode).toBe(201);
    expect((res.body as { status?: string; isDirectApproval?: boolean })?.status).toBe('approved');
    expect((res.body as { isDirectApproval?: boolean })?.isDirectApproval).toBe(true);
  });

  it('rejects spoofed files by magic bytes', async () => {
    const channel = await createChannel({ submissionsEnabled: true, submissionsOnlyWhenLive: false });
    const viewer = await createUser({ role: 'viewer', channelId: null });

    const junk = Buffer.from('not a video');
    const filePath = await writeTempFile(junk, 'junk.mp4');

    vi.mocked(processSubmissionUpload).mockImplementationOnce(async ({ res }) => {
      res.status(413).json({ errorCode: 'FILE_TOO_LARGE' });
      return null;
    });

    const emitted: EmitCall[] = [];
    const req = buildRequest({
      userId: viewer.id,
      userRole: 'viewer',
      channelId: channel.id,
      filePath,
      mimeType: 'video/mp4',
      fileSize: junk.length,
      title: 'Bad File',
      appIoEmits: emitted,
    });
    const res = createRes();

    await createSubmissionWithRepos(repositories, req, res as unknown as Response);

    expect(res.statusCode).toBe(400);
    expect((res.body as { errorCode?: string })?.errorCode).toBe('INVALID_FILE_CONTENT');
    expect(emitted).toHaveLength(0);
  });

  it('rejects files over 50MB', async () => {
    const channel = await createChannel({ submissionsEnabled: true, submissionsOnlyWhenLive: false });
    const viewer = await createUser({ role: 'viewer', channelId: null });

    const mp4Header = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const filePath = await writeTempFile(mp4Header, 'large.mp4');

    const emitted: EmitCall[] = [];
    const req = buildRequest({
      userId: viewer.id,
      userRole: 'viewer',
      channelId: channel.id,
      filePath,
      mimeType: 'video/mp4',
      fileSize: 50 * 1024 * 1024 + 1,
      title: 'Large File',
      appIoEmits: emitted,
    });
    const res = createRes();

    await createSubmissionWithRepos(repositories, req, res as unknown as Response);

    expect(res.statusCode).toBe(413);
    expect((res.body as { errorCode?: string })?.errorCode).toBe('FILE_TOO_LARGE');
  });

  it('rejects videos longer than 15 seconds', async () => {
    const channel = await createChannel({ submissionsEnabled: true, submissionsOnlyWhenLive: false });
    const viewer = await createUser({ role: 'viewer', channelId: null });

    vi.mocked(getVideoMetadata).mockResolvedValue({ duration: 20, size: 1024 });

    const mp4Header = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const filePath = await writeTempFile(mp4Header, 'long.mp4');
    vi.mocked(processSubmissionUpload).mockImplementationOnce(async ({ res }) => {
      res.status(413).json({ errorCode: 'VIDEO_TOO_LONG' });
      return null;
    });

    const emitted: EmitCall[] = [];
    const req = buildRequest({
      userId: viewer.id,
      userRole: 'viewer',
      channelId: channel.id,
      filePath,
      mimeType: 'video/mp4',
      fileSize: mp4Header.length,
      title: 'Too Long',
      appIoEmits: emitted,
    });
    const res = createRes();

    await createSubmissionWithRepos(repositories, req, res as unknown as Response);

    expect(res.statusCode).toBe(413);
    expect((res.body as { errorCode?: string })?.errorCode).toBe('VIDEO_TOO_LONG');
  });

  it('deduplicates uploads by file hash', async () => {
    const channel = await createChannel({ submissionsEnabled: true, submissionsOnlyWhenLive: false });
    const viewer = await createUser({ role: 'viewer', channelId: null });

    const content = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
      crypto.randomBytes(16),
    ]);

    const filePathA = await writeTempFile(content, 'dup-a.mp4');
    const filePathB = await writeTempFile(content, 'dup-b.mp4');

    const emittedA: EmitCall[] = [];
    const reqA = buildRequest({
      userId: viewer.id,
      userRole: 'viewer',
      channelId: channel.id,
      filePath: filePathA,
      mimeType: 'video/mp4',
      fileSize: content.length,
      title: 'Dup A',
      appIoEmits: emittedA,
    });
    const resA = createRes();

    await createSubmissionWithRepos(repositories, reqA, resA as unknown as Response);

    const emittedB: EmitCall[] = [];
    const reqB = buildRequest({
      userId: viewer.id,
      userRole: 'viewer',
      channelId: channel.id,
      filePath: filePathB,
      mimeType: 'video/mp4',
      fileSize: content.length,
      title: 'Dup B',
      appIoEmits: emittedB,
    });
    const resB = createRes();

    await createSubmissionWithRepos(repositories, reqB, resB as unknown as Response);

    const submissionIdA = (resA.body as { id?: string })?.id;
    const submissionIdB = (resB.body as { id?: string })?.id;
    const submissionA = await prisma.memeSubmission.findUnique({ where: { id: submissionIdA! } });
    const submissionB = await prisma.memeSubmission.findUnique({ where: { id: submissionIdB! } });

    expect(submissionA?.fileHash).toBeTruthy();
    expect(submissionA?.fileHash).toBe(submissionB?.fileHash);

    const hash = submissionA?.fileHash || '';
    const fileHash = await prisma.fileHash.findUnique({ where: { hash } });
    expect(fileHash?.referenceCount).toBeGreaterThanOrEqual(2);
  });

  it('returns existing submission for idempotency keys', async () => {
    const channel = await createChannel({ submissionsEnabled: true, submissionsOnlyWhenLive: false });
    const viewer = await createUser({ role: 'viewer', channelId: null });

    const mp4Header = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const filePathA = await writeTempFile(mp4Header, 'idem-a.mp4');
    const filePathB = await writeTempFile(mp4Header, 'idem-b.mp4');

    const emitted: EmitCall[] = [];
    const reqA = buildRequest({
      userId: viewer.id,
      userRole: 'viewer',
      channelId: channel.id,
      filePath: filePathA,
      mimeType: 'video/mp4',
      fileSize: mp4Header.length,
      title: 'Idem',
      idempotencyKey: 'idem-1',
      appIoEmits: emitted,
    });
    const resA = createRes();

    await createSubmissionWithRepos(repositories, reqA, resA as unknown as Response);

    const reqB = buildRequest({
      userId: viewer.id,
      userRole: 'viewer',
      channelId: channel.id,
      filePath: filePathB,
      mimeType: 'video/mp4',
      fileSize: mp4Header.length,
      title: 'Idem',
      idempotencyKey: 'idem-1',
      appIoEmits: emitted,
    });
    const resB = createRes();

    await createSubmissionWithRepos(repositories, reqB, resB as unknown as Response);

    expect(resA.statusCode).toBe(201);
    expect(resB.statusCode).toBe(200);
    expect((resA.body as { id?: string })?.id).toBe((resB.body as { id?: string })?.id);

    const submissions = await prisma.memeSubmission.findMany({
      where: { channelId: channel.id, submitterUserId: viewer.id, idempotencyKey: 'idem-1' },
    });
    expect(submissions).toHaveLength(1);

    const createdEvents = emitted.filter((e) => e.event === 'submission:created');
    expect(createdEvents).toHaveLength(1);
  });
});
