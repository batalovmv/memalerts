import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { approveSubmissionInternal } from '../src/services/approveSubmissionInternal.js';
import { cleanupPendingSubmissionFilesOnce } from '../src/jobs/cleanupPendingSubmissionFiles.js';
import { createChannel, createFileHash, createSubmission, createUser } from './factories/index.js';

function rand(): string {
  return Math.random().toString(16).slice(2);
}

describe('AI moderation core building blocks', () => {
  it('approveSubmissionInternal is idempotent (second call is no-op)', async () => {
    const channel = await createChannel({
      slug: `ch_${rand()}`,
      name: `Channel ${rand()}`,
      defaultPriceCoins: 123,
    });

    const viewer = await createUser({
      displayName: `Viewer ${rand()}`,
      role: 'viewer',
      hasBetaAccess: false,
      channelId: null,
    });

    const submissionData = {
      channelId: channel.id,
      submitterUserId: viewer.id,
      title: 'Some meme',
      type: 'video',
      fileUrlTemp: '/uploads/memes/dummy.mp4',
      status: 'pending',
      sourceKind: 'upload',
      fileHash: `hash_${rand()}`,
      durationMs: 1000,
      aiAutoTagNamesJson: ['cat', 'funny'],
      aiAutoDescription: 'A funny cat meme about something',
    } satisfies Prisma.MemeSubmissionCreateInput;
    const submission = await createSubmission(submissionData);

    // Meme.fileHash has a FK to FileHash.hash in this project.
    await createFileHash({
      hash: submission.fileHash ?? `hash_${rand()}`,
      filePath: '/uploads/memes/dummy.mp4',
      referenceCount: 1,
      fileSize: BigInt(1),
      mimeType: 'video/mp4',
    });

    const first = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      return await approveSubmissionInternal({
        tx,
        submissionId: submission.id,
        approvedByUserId: null,
        resolved: {
          finalFileUrl: '/uploads/memes/dummy.mp4',
          fileHash: submission.fileHash,
          durationMs: 1000,
          priceCoins: 123,
          tagNames: ['cat', 'funny'],
        },
      });
    });

    expect(first.alreadyApproved).toBe(false);

    const second = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      return await approveSubmissionInternal({
        tx,
        submissionId: submission.id,
        approvedByUserId: null,
        resolved: {
          finalFileUrl: '/uploads/memes/dummy.mp4',
          fileHash: null,
          durationMs: 1000,
          priceCoins: 123,
          tagNames: ['cat', 'funny'],
        },
      });
    });

    expect(second.alreadyApproved).toBe(true);

    const cms = await prisma.channelMeme.findMany({ where: { channelId: channel.id } });
    expect(cms.length).toBe(1);

    const cm = await prisma.channelMeme.findFirst({
      where: { channelId: channel.id },
      select: { title: true, memeAssetId: true },
    });
    expect(cm?.title).toBe('Some meme');

    const asset = cm?.memeAssetId ? await prisma.memeAsset.findUnique({ where: { id: cm.memeAssetId } }) : null;
    expect(typeof asset?.aiSearchText).toBe('string');
    expect(String(asset?.aiSearchText || '')).toContain('Some meme');
    expect(String(asset?.aiSearchText || '')).toContain('cat');
    expect(String(asset?.aiSearchText || '')).toContain('funny');
    expect(String(asset?.aiSearchText || '')).toContain('A funny cat meme');
  });

  it('cleanupPendingSubmissionFilesOnce marks old failed pending submissions as failed and decrements FileHash ref', async () => {
    const channel = await createChannel({ slug: `ch_${rand()}`, name: `Channel ${rand()}` });
    const viewer = await createUser({ displayName: `Viewer ${rand()}`, role: 'viewer', hasBetaAccess: false });

    const hash = `dead_${rand()}`;
    await createFileHash({
      hash,
      filePath: '/uploads/memes/dead.mp4',
      referenceCount: 1,
      fileSize: BigInt(1),
      mimeType: 'video/mp4',
    });

    const old = new Date(Date.now() - 1000 * 60 * 60 * 80); // 80h ago
    const oldSubmissionData = {
      channelId: channel.id,
      submitterUserId: viewer.id,
      title: 'Old pending',
      type: 'video',
      fileUrlTemp: '/uploads/memes/dead.mp4',
      status: 'pending',
      sourceKind: 'upload',
      fileHash: hash,
      durationMs: 1000,
      aiStatus: 'failed',
      aiRetryCount: 5,
      createdAt: old,
    } satisfies Prisma.MemeSubmissionCreateInput;
    await createSubmission(oldSubmissionData);

    const res = await cleanupPendingSubmissionFilesOnce({ retentionHours: 72, maxRetries: 5, batchSize: 100 });
    expect(res.cleaned).toBe(1);

    const updated = await prisma.memeSubmission.findFirst({
      where: { channelId: channel.id, title: 'Old pending' },
      select: { aiStatus: true, aiError: true },
    });
    expect(updated?.aiStatus).toBe('failed');
    expect(updated?.aiError).toBe('retention_expired');

    const fh = await prisma.fileHash.findUnique({ where: { hash } });
    expect(fh).toBeNull();
  });
});
