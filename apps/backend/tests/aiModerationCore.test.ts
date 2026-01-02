import { prisma } from '../src/lib/prisma.js';
import { approveSubmissionInternal } from '../src/services/approveSubmissionInternal.js';
import { cleanupPendingSubmissionFilesOnce } from '../src/jobs/cleanupPendingSubmissionFiles.js';

function rand(): string {
  return Math.random().toString(16).slice(2);
}

describe('AI moderation core building blocks', () => {
  it('approveSubmissionInternal is idempotent (second call is no-op)', async () => {
    const channel = await prisma.channel.create({
      data: { slug: `ch_${rand()}`, name: `Channel ${rand()}`, defaultPriceCoins: 123 },
      select: { id: true },
    });

    const viewer = await prisma.user.create({
      data: { displayName: `Viewer ${rand()}`, role: 'viewer', hasBetaAccess: false, channelId: null },
      select: { id: true },
    });

    const submission = await prisma.memeSubmission.create({
      data: {
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
      } as any,
      select: { id: true, fileHash: true },
    });

    // Meme.fileHash has a FK to FileHash.hash in this project.
    await prisma.fileHash.create({
      data: {
        hash: submission.fileHash,
        filePath: '/uploads/memes/dummy.mp4',
        referenceCount: 1,
        fileSize: BigInt(1),
        mimeType: 'video/mp4',
      },
    });

    const first = await prisma.$transaction(async (tx) => {
      return await approveSubmissionInternal({
        tx: tx as any,
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

    const second = await prisma.$transaction(async (tx) => {
      return await approveSubmissionInternal({
        tx: tx as any,
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
  });

  it('cleanupPendingSubmissionFilesOnce marks old failed pending submissions as failed_final and decrements FileHash ref', async () => {
    const channel = await prisma.channel.create({
      data: { slug: `ch_${rand()}`, name: `Channel ${rand()}` },
      select: { id: true },
    });
    const viewer = await prisma.user.create({
      data: { displayName: `Viewer ${rand()}`, role: 'viewer', hasBetaAccess: false },
      select: { id: true },
    });

    const hash = `dead_${rand()}`;
    await prisma.fileHash.create({
      data: {
        hash,
        filePath: '/uploads/memes/dead.mp4',
        referenceCount: 1,
        fileSize: BigInt(1),
        mimeType: 'video/mp4',
      },
    });

    const old = new Date(Date.now() - 1000 * 60 * 60 * 80); // 80h ago
    await prisma.memeSubmission.create({
      data: {
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
      } as any,
    });

    const res = await cleanupPendingSubmissionFilesOnce({ retentionHours: 72, maxRetries: 5, batchSize: 100 });
    expect(res.cleaned).toBe(1);

    const updated = await prisma.memeSubmission.findFirst({
      where: { channelId: channel.id, title: 'Old pending' },
      select: { aiStatus: true, aiError: true },
    });
    expect(updated?.aiStatus).toBe('failed_final');
    expect(updated?.aiError).toBe('retention_expired');

    const fh = await prisma.fileHash.findUnique({ where: { hash } });
    expect(fh).toBeNull();
  });
});


