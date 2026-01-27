import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import type { Response } from 'express';
import type { AuthRequest } from '../src/middleware/auth.js';
import { prisma } from '../src/lib/prisma.js';
import { repositories } from '../src/repositories/index.js';
import { approveSubmissionWithRepos } from '../src/services/submission/submissionApprove.js';
import { rejectSubmissionWithRepos } from '../src/services/submission/submissionReject.js';
import { needsChangesSubmissionWithRepos } from '../src/services/submission/submissionNeedsChanges.js';
import { createChannel, createSubmission, createUser } from './factories/index.js';
import { getVideoMetadata } from '../src/utils/videoValidator.js';
import { emitSubmissionEvent, relaySubmissionEventToPeer } from '../src/realtime/submissionBridge.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer } from '../src/realtime/walletBridge.js';

vi.mock('../src/utils/videoValidator.js', () => ({
  getVideoMetadata: vi.fn(),
}));

vi.mock('../src/realtime/submissionBridge.js', () => ({
  emitSubmissionEvent: vi.fn(),
  relaySubmissionEventToPeer: vi.fn(),
}));

vi.mock('../src/realtime/walletBridge.js', () => ({
  emitWalletUpdated: vi.fn(),
  relayWalletUpdatedToPeer: vi.fn(),
}));

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
  submissionId: string;
  body: Record<string, unknown>;
}): AuthRequest {
  const { userId, userRole, channelId, submissionId, body } = params;
  const app = {
    get(key: string) {
      if (key === 'io') return {};
      return undefined;
    },
  };

  return {
    userId,
    userRole,
    channelId: channelId ?? undefined,
    params: { id: submissionId },
    body,
    query: {},
    headers: { 'user-agent': 'vitest' },
    socket: { remoteAddress: '127.0.0.1' } as unknown as AuthRequest['socket'],
    app,
  } as AuthRequest;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe('submission moderation flow', () => {
  const originalEnv = { ...process.env };
  let uploadDir: string;

  beforeAll(async () => {
    uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memalerts-uploads-'));
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.REDIS_URL = '';
    process.env.AI_BULLMQ_ENABLED = '0';
    process.env.UPLOAD_STORAGE = 'local';
    process.env.UPLOAD_DIR = uploadDir;
    process.env.SUBMISSION_MAX_RESUBMITS = '2';
    vi.mocked(getVideoMetadata).mockResolvedValue({ duration: 5, size: 1024 });
    vi.clearAllMocks();
  });

  afterAll(async () => {
    process.env = originalEnv;
    if (uploadDir) {
      await fs.rm(uploadDir, { recursive: true, force: true });
    }
  });

  it('approves pending uploads, rewards submitter with legacy onlyWhenLive, and moves files', async () => {
    const channel = await createChannel({
      defaultPriceCoins: 125,
      submissionRewardCoinsUpload: 25,
      submissionRewardOnlyWhenLive: true,
    });
    const owner = await createUser({ role: 'streamer', channelId: channel.id });
    const submitter = await createUser({ role: 'viewer', channelId: null });

    const fileDir = path.join(uploadDir, 'memes');
    await fs.mkdir(fileDir, { recursive: true });
    const fileContent = Buffer.from('memalerts-approve-file');
    const tempFilePath = path.join(fileDir, `temp-${Date.now()}.mp4`);
    await fs.writeFile(tempFilePath, fileContent);
    const relativePath = path.relative(uploadDir, tempFilePath).replace(/\\/g, '/');
    const expectedHash = crypto.createHash('sha256').update(fileContent).digest('hex');
    const expectedPublicPath = `/uploads/memes/${expectedHash}.mp4`;
    const expectedLocalPath = path.join(uploadDir, 'memes', `${expectedHash}.mp4`);

    const submission = await createSubmission({
      channelId: channel.id,
      submitterUserId: submitter.id,
      title: 'Pending Approval',
      status: 'pending',
      sourceKind: 'upload',
      fileUrlTemp: relativePath,
      sourceUrl: null,
      fileHash: null,
    });

    const req = buildReq({
      userId: owner.id,
      userRole: 'streamer',
      channelId: channel.id,
      submissionId: submission.id,
      body: { priceCoins: 200 },
    });
    const res = createRes();

    await approveSubmissionWithRepos(repositories, req, res as unknown as Response);

    expect(res.statusCode).toBe(200);

    const updatedSubmission = await prisma.memeSubmission.findUnique({ where: { id: submission.id } });
    expect(updatedSubmission?.status).toBe('approved');
    expect(updatedSubmission?.memeAssetId).toBeTruthy();

    const asset = await prisma.memeAsset.findUnique({ where: { id: updatedSubmission!.memeAssetId! } });
    expect(asset?.fileUrl).toBe(expectedPublicPath);
    expect(asset?.fileHash).toBe(expectedHash);

    const channelMeme = await prisma.channelMeme.findFirst({
      where: { channelId: channel.id, memeAssetId: asset!.id },
    });
    expect(channelMeme?.status).toBe('approved');
    expect(channelMeme?.priceCoins).toBe(200);

    const wallet = await prisma.wallet.findUnique({
      where: { userId_channelId: { userId: submitter.id, channelId: channel.id } },
    });
    expect(wallet?.balance).toBe(45);

    expect(await fileExists(expectedLocalPath)).toBe(true);
    expect(await fileExists(tempFilePath)).toBe(false);

    const submissionCalls = vi.mocked(emitSubmissionEvent).mock.calls;
    expect(submissionCalls.some((call) => (call[1] as { event?: string }).event === 'submission:approved')).toBe(true);
    expect(vi.mocked(relaySubmissionEventToPeer)).toHaveBeenCalled();

    const walletCalls = vi.mocked(emitWalletUpdated).mock.calls;
    expect(walletCalls.some((call) => (call[1] as { delta?: number }).delta === 45)).toBe(true);
    expect(vi.mocked(relayWalletUpdatedToPeer)).toHaveBeenCalled();
  });

  it('rejects submissions with moderator notes', async () => {
    const channel = await createChannel();
    const owner = await createUser({ role: 'streamer', channelId: channel.id });
    const submitter = await createUser({ role: 'viewer', channelId: null });
    const submission = await createSubmission({
      channelId: channel.id,
      submitterUserId: submitter.id,
      status: 'pending',
    });

    const req = buildReq({
      userId: owner.id,
      userRole: 'streamer',
      channelId: channel.id,
      submissionId: submission.id,
      body: { moderatorNotes: 'Not acceptable' },
    });
    const res = createRes();

    await rejectSubmissionWithRepos(repositories, req, res as unknown as Response);

    expect(res.statusCode).toBe(200);
    const updated = await prisma.memeSubmission.findUnique({ where: { id: submission.id } });
    expect(updated?.status).toBe('rejected');
    expect(updated?.moderatorNotes).toBe('Not acceptable');

    const calls = vi.mocked(emitSubmissionEvent).mock.calls;
    expect(calls.some((call) => (call[1] as { event?: string }).event === 'submission:rejected')).toBe(true);
  });

  it('marks submissions as needs changes with feedback', async () => {
    const channel = await createChannel();
    const owner = await createUser({ role: 'streamer', channelId: channel.id });
    const submitter = await createUser({ role: 'viewer', channelId: null });
    const submission = await createSubmission({
      channelId: channel.id,
      submitterUserId: submitter.id,
      status: 'pending',
    });

    const req = buildReq({
      userId: owner.id,
      userRole: 'streamer',
      channelId: channel.id,
      submissionId: submission.id,
      body: { moderatorNotes: 'Trim the clip' },
    });
    const res = createRes();

    await needsChangesSubmissionWithRepos(repositories, req, res as unknown as Response);

    expect(res.statusCode).toBe(200);
    const updated = await prisma.memeSubmission.findUnique({ where: { id: submission.id } });
    expect(updated?.status).toBe('needs_changes');
    expect(updated?.moderatorNotes).toBe('Trim the clip');

    const calls = vi.mocked(emitSubmissionEvent).mock.calls;
    expect(calls.some((call) => (call[1] as { event?: string }).event === 'submission:needs_changes')).toBe(true);
  });

  it('blocks moderation from non-owners', async () => {
    const channel = await createChannel();
    const owner = await createUser({ role: 'streamer', channelId: channel.id });
    const otherChannel = await createChannel();
    const otherStreamer = await createUser({ role: 'streamer', channelId: otherChannel.id });
    const submission = await createSubmission({
      channelId: channel.id,
      submitterUserId: owner.id,
      status: 'pending',
    });

    const req = buildReq({
      userId: otherStreamer.id,
      userRole: 'streamer',
      channelId: otherChannel.id,
      submissionId: submission.id,
      body: { priceCoins: 100 },
    });
    const res = createRes();

    await approveSubmissionWithRepos(repositories, req, res as unknown as Response);

    expect(res.statusCode).toBe(404);
    expect((res.body as { errorCode?: string })?.errorCode).toBe('SUBMISSION_NOT_FOUND');
  });
});
