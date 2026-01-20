import type { Response } from 'express';
import type { AuthRequest } from '../src/middleware/auth.js';
import { prisma } from '../src/lib/prisma.js';
import { createChannel, createUser, createMemeAsset, createChannelMeme, createFileHash } from './factories/index.js';

vi.mock('../src/controllers/submission/importMemeDownload.js', () => ({
  downloadAndPrepareImportFile: vi.fn(),
}));

import { importMeme } from '../src/controllers/submission/importMeme.js';
import { downloadAndPrepareImportFile } from '../src/controllers/submission/importMemeDownload.js';

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

function buildReq(params: {
  userId: string;
  userRole: string;
  channelId: string | null;
  body: Record<string, unknown>;
}): AuthRequest {
  const { userId, userRole, channelId, body } = params;
  return {
    userId,
    userRole,
    channelId: channelId ?? undefined,
    body,
    query: {},
    headers: {},
    socket: { remoteAddress: '127.0.0.1' } as unknown as AuthRequest['socket'],
  } as AuthRequest;
}

describe('submission import flow', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.DOMAIN = 'example.com';
    process.env.PORT = '3003';
    process.env.REDIS_URL = '';
    process.env.AI_BULLMQ_ENABLED = '0';
    vi.mocked(downloadAndPrepareImportFile).mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('imports a valid URL as pending submission for viewers', async () => {
    const channel = await createChannel({ submissionsEnabled: true, submissionsOnlyWhenLive: false });
    const viewer = await createUser({ role: 'viewer', channelId: null });

    vi.mocked(downloadAndPrepareImportFile).mockResolvedValue({
      finalFilePath: '/uploads/memes/import-hash.mp4',
      fileHash: 'import-hash',
      detectedDurationMs: 5000,
      fileHashForCleanup: 'import-hash',
      fileHashRefAdded: true,
    });

    const req = buildReq({
      userId: viewer.id,
      userRole: 'viewer',
      channelId: channel.id,
      body: {
        channelId: channel.id,
        title: 'Imported Meme',
        sourceUrl: 'https://memalerts.com/memes/123.mp4',
        notes: 'note',
        tags: ['import', 'meme'],
      },
    });
    const res = createRes();

    await importMeme(req, res as unknown as Response);

    expect(res.statusCode).toBe(201);
    const submissionId = (res.body as { id?: string })?.id;
    const submission = await prisma.memeSubmission.findUnique({
      where: { id: submissionId! },
      include: { tags: { include: { tag: true } } },
    });
    expect(submission?.status).toBe('pending');
    const tagNames = submission?.tags.map((t) => t.tag.name).sort();
    expect(tagNames).toEqual(['import', 'meme']);
  });

  it('rejects invalid URLs before download', async () => {
    const channel = await createChannel({ submissionsEnabled: true, submissionsOnlyWhenLive: false });
    const viewer = await createUser({ role: 'viewer', channelId: null });

    const req = buildReq({
      userId: viewer.id,
      userRole: 'viewer',
      channelId: channel.id,
      body: {
        channelId: channel.id,
        title: 'Bad URL',
        sourceUrl: 'https://example.com/not-allowed.mp4',
      },
    });
    const res = createRes();

    await importMeme(req, res as unknown as Response);

    expect(res.statusCode).toBe(400);
    expect((res.body as { errorCode?: string })?.errorCode).toBe('INVALID_MEDIA_URL');
  });

  it('maps download errors to proper responses', async () => {
    const channel = await createChannel({ submissionsEnabled: true, submissionsOnlyWhenLive: false });
    const viewer = await createUser({ role: 'viewer', channelId: null });

    vi.mocked(downloadAndPrepareImportFile).mockRejectedValue(
      Object.assign(new Error('bad'), { code: 'INVALID_FILE_CONTENT', details: { detectedType: 'text/plain' } })
    );

    const req = buildReq({
      userId: viewer.id,
      userRole: 'viewer',
      channelId: channel.id,
      body: {
        channelId: channel.id,
        title: 'Import',
        sourceUrl: 'https://memalerts.com/memes/123.mp4',
      },
    });
    const res = createRes();

    await importMeme(req, res as unknown as Response);
    expect(res.statusCode).toBe(400);
    expect((res.body as { errorCode?: string })?.errorCode).toBe('INVALID_FILE_CONTENT');

    vi.mocked(downloadAndPrepareImportFile).mockRejectedValue(
      Object.assign(new Error('big'), { code: 'FILE_TOO_LARGE', details: { maxBytes: 1, sizeBytes: 2 } })
    );
    const res2 = createRes();
    await importMeme(req, res2 as unknown as Response);
    expect(res2.statusCode).toBe(413);
    expect((res2.body as { errorCode?: string })?.errorCode).toBe('FILE_TOO_LARGE');

    vi.mocked(downloadAndPrepareImportFile).mockRejectedValue(
      Object.assign(new Error('long'), { code: 'VIDEO_TOO_LONG', details: { maxDurationMs: 15000, durationMs: 20000 } })
    );
    const res3 = createRes();
    await importMeme(req, res3 as unknown as Response);
    expect(res3.statusCode).toBe(413);
    expect((res3.body as { errorCode?: string })?.errorCode).toBe('VIDEO_TOO_LONG');

    vi.mocked(downloadAndPrepareImportFile).mockRejectedValue(new Error('timeout'));
    const res4 = createRes();
    await importMeme(req, res4 as unknown as Response);
    expect(res4.statusCode).toBe(502);
    expect((res4.body as { errorCode?: string })?.errorCode).toBe('UPLOAD_FAILED');
  });

  it('returns conflict when meme is already in channel', async () => {
    const channel = await createChannel({ submissionsEnabled: true, submissionsOnlyWhenLive: false });
    const viewer = await createUser({ role: 'viewer', channelId: null });
    await createFileHash({ hash: 'dup-hash', filePath: '/uploads/memes/dup.mp4', mimeType: 'video/mp4' });
    const asset = await createMemeAsset({ fileHash: 'dup-hash', fileUrl: '/uploads/memes/dup.mp4' });
    await createChannelMeme({ channelId: channel.id, memeAssetId: asset.id, status: 'approved' });

    vi.mocked(downloadAndPrepareImportFile).mockResolvedValue({
      finalFilePath: '/uploads/memes/dup.mp4',
      fileHash: 'dup-hash',
      detectedDurationMs: 5000,
      fileHashForCleanup: 'dup-hash',
      fileHashRefAdded: true,
    });

    const req = buildReq({
      userId: viewer.id,
      userRole: 'viewer',
      channelId: channel.id,
      body: {
        channelId: channel.id,
        title: 'Dup',
        sourceUrl: 'https://memalerts.com/memes/dup.mp4',
      },
    });
    const res = createRes();

    await importMeme(req, res as unknown as Response);

    expect(res.statusCode).toBe(409);
    expect((res.body as { errorCode?: string })?.errorCode).toBe('ALREADY_IN_CHANNEL');
  });

  it('auto-approves imports from channel owners', async () => {
    const channel = await createChannel({ submissionsEnabled: true, submissionsOnlyWhenLive: false });
    const owner = await createUser({ role: 'streamer', channelId: channel.id });
    await createFileHash({ hash: 'owner-hash', filePath: '/uploads/memes/owner-import.mp4', mimeType: 'video/mp4' });

    vi.mocked(downloadAndPrepareImportFile).mockResolvedValue({
      finalFilePath: '/uploads/memes/owner-import.mp4',
      fileHash: 'owner-hash',
      detectedDurationMs: 4000,
      fileHashForCleanup: 'owner-hash',
      fileHashRefAdded: true,
    });

    const req = buildReq({
      userId: owner.id,
      userRole: 'streamer',
      channelId: channel.id,
      body: {
        channelId: channel.id,
        title: 'Owner Import',
        sourceUrl: 'https://memalerts.com/memes/owner.mp4',
      },
    });
    const res = createRes();

    await importMeme(req, res as unknown as Response);

    expect(res.statusCode).toBe(201);
    expect((res.body as { isDirectApproval?: boolean })?.isDirectApproval).toBe(true);
    expect((res.body as { status?: string })?.status).toBe('approved');
  });
});
