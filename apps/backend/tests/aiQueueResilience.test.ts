import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import {
  computeAiFailureUpdate,
  enqueueAiForSubmission,
  runAiWatchdogOnce,
  tryClaimAiSubmission,
} from '../src/jobs/aiQueue.js';
import { processOneSubmission } from '../src/jobs/aiModerationSubmissions.js';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { createChannel, createSubmission, createUser } from './factories/index.js';

function rand(): string {
  return Math.random().toString(16).slice(2);
}

async function createBaseEntities() {
  const channel = await createChannel({
    slug: `ch_${rand()}`,
    name: `Channel ${rand()}`,
    defaultPriceCoins: 100,
  });
  const user = await createUser({
    displayName: `User ${rand()}`,
    role: 'viewer',
    hasBetaAccess: false,
    channelId: null,
  });
  return { channel, user };
}

describe('AI queue resilience', () => {
  it('idempotent enqueue keeps a single submission and does not duplicate state', async () => {
    const { channel, user } = await createBaseEntities();
    const submissionData = {
      channelId: channel.id,
      submitterUserId: user.id,
      title: 'Test',
      type: 'video',
      fileUrlTemp: '/uploads/memes/test.mp4',
      sourceKind: 'upload',
      status: 'pending',
      aiStatus: 'pending',
    } satisfies Prisma.MemeSubmissionCreateInput;
    const submission = await createSubmission(submissionData);

    for (let i = 0; i < 10; i++) {
      await enqueueAiForSubmission(submission.id, { reason: 'test' });
    }

    const count = await prisma.memeSubmission.count({ where: { id: submission.id } });
    const updated = await prisma.memeSubmission.findUnique({
      where: { id: submission.id },
      select: { aiStatus: true, aiRetryCount: true, aiNextRetryAt: true },
    });

    expect(count).toBe(1);
    expect(updated?.aiStatus).toBe('pending');
    expect(updated?.aiRetryCount).toBe(0);
    expect(updated?.aiNextRetryAt).toBeNull();
  });

  it('lock prevents double processing', async () => {
    const { channel, user } = await createBaseEntities();
    const submissionData = {
      channelId: channel.id,
      submitterUserId: user.id,
      title: 'Lock test',
      type: 'video',
      fileUrlTemp: '/uploads/memes/test.mp4',
      sourceKind: 'upload',
      status: 'pending',
      aiStatus: 'pending',
    } satisfies Prisma.MemeSubmissionCreateInput;
    const submission = await createSubmission(submissionData);

    const [a, b] = await Promise.all([
      tryClaimAiSubmission({ submissionId: submission.id, workerId: 'worker-a' }),
      tryClaimAiSubmission({ submissionId: submission.id, workerId: 'worker-b' }),
    ]);

    expect(a.claimed !== b.claimed).toBe(true);

    const updated = await prisma.memeSubmission.findUnique({
      where: { id: submission.id },
      select: { aiStatus: true, aiLockedBy: true, aiLockExpiresAt: true },
    });

    expect(updated?.aiStatus).toBe('processing');
    expect(['worker-a', 'worker-b']).toContain(updated?.aiLockedBy);
    expect(updated?.aiLockExpiresAt).not.toBeNull();
  });

  it('watchdog recovers stuck processing and schedules retry', async () => {
    const { channel, user } = await createBaseEntities();
    const past = new Date(Date.now() - 60_000);
    const submissionData = {
      channelId: channel.id,
      submitterUserId: user.id,
      title: 'Stuck test',
      type: 'video',
      fileUrlTemp: '/uploads/memes/test.mp4',
      sourceKind: 'upload',
      status: 'pending',
      aiStatus: 'processing',
      aiRetryCount: 1,
      aiLastTriedAt: past,
      aiProcessingStartedAt: past,
      aiLockedBy: 'worker',
      aiLockExpiresAt: new Date(Date.now() - 5_000),
    } satisfies Prisma.MemeSubmissionCreateInput;
    const submission = await createSubmission(submissionData);

    const res = await runAiWatchdogOnce({ limit: 50 });
    expect(res.recovered).toBeGreaterThanOrEqual(1);

    const updated = await prisma.memeSubmission.findUnique({
      where: { id: submission.id },
      select: { aiStatus: true, aiRetryCount: true, aiNextRetryAt: true, aiError: true, aiLockedBy: true },
    });

    expect(updated?.aiStatus).toBe('pending');
    expect(updated?.aiRetryCount).toBe(2);
    expect(updated?.aiNextRetryAt).not.toBeNull();
    expect(updated?.aiError).toBe('stuck_recovered');
    expect(updated?.aiLockedBy).toBeNull();
  });

  it('retry backoff stops after max attempts', async () => {
    const { channel, user } = await createBaseEntities();
    const submissionData = {
      channelId: channel.id,
      submitterUserId: user.id,
      title: 'Retry test',
      type: 'video',
      fileUrlTemp: '/uploads/memes/test.mp4',
      sourceKind: 'upload',
      status: 'pending',
      aiStatus: 'processing',
      aiRetryCount: 0,
    } satisfies Prisma.MemeSubmissionCreateInput;
    const submission = await createSubmission(submissionData);

    const maxAttempts = 3;
    let prevAttempts = 0;
    for (let i = 0; i < maxAttempts; i++) {
      const update = computeAiFailureUpdate({
        prevAttempts,
        now: new Date(Date.now() + i * 1000),
        errorMessage: 'boom',
        maxAttempts,
      });
      await prisma.memeSubmission.update({ where: { id: submission.id }, data: update });
      prevAttempts = update.aiRetryCount;
    }

    const updated = await prisma.memeSubmission.findUnique({
      where: { id: submission.id },
      select: { aiStatus: true, aiRetryCount: true, aiNextRetryAt: true, aiError: true },
    });

    expect(updated?.aiRetryCount).toBe(maxAttempts);
    expect(updated?.aiStatus).toBe('failed');
    expect(updated?.aiNextRetryAt).toBeNull();
    expect(updated?.aiError).toBe('boom');
  });

  it('done validation blocks placeholder outputs', async () => {
    const prevKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const { channel, user } = await createBaseEntities();
    const hash = randomBytes(32).toString('hex');
    const relPath = path.join('uploads', 'memes', `${hash}.mp4`);
    const absPath = path.resolve(process.cwd(), relPath);

    await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
    await fs.promises.writeFile(absPath, 'test');

    const submissionData = {
      channelId: channel.id,
      submitterUserId: user.id,
      title: 'Meme',
      type: 'video',
      fileUrlTemp: `/uploads/memes/${hash}.mp4`,
      sourceKind: 'upload',
      status: 'pending',
      fileHash: hash,
      durationMs: 1000,
      aiStatus: 'pending',
    } satisfies Prisma.MemeSubmissionCreateInput;
    const submission = await createSubmission(submissionData);

    let thrown = false;
    try {
      await processOneSubmission(submission.id);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e ?? '');
      thrown = message.includes('ai_output_invalid');
    }

    const updated = await prisma.memeSubmission.findUnique({
      where: { id: submission.id },
      select: { aiStatus: true },
    });

    expect(thrown).toBe(true);
    expect(updated?.aiStatus).not.toBe('done');

    await fs.promises.rm(absPath, { force: true });
    if (prevKey) process.env.OPENAI_API_KEY = prevKey;
  });
});
