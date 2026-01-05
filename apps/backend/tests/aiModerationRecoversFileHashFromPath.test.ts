import { prisma } from '../src/lib/prisma.js';
import { processOneSubmission } from '../src/jobs/aiModerationSubmissions.js';

function rand(): string {
  return Math.random().toString(16).slice(2);
}

describe('AI moderation recovers fileHash from fileUrlTemp when missing', () => {
  it('derives sha256 from /uploads/memes/<sha256>.<ext> and does not fail with missing_filehash', async () => {
    const channel = await prisma.channel.create({
      data: { slug: `ch_${rand()}`, name: `Channel ${rand()}`, defaultPriceCoins: 100 },
      select: { id: true },
    });

    const user = await prisma.user.create({
      data: { displayName: `User ${rand()}`, role: 'viewer', hasBetaAccess: false, channelId: null },
      select: { id: true },
    });

    const sha = '5ac5120e3b9ace2f3447444b42250a74a2925bcc75361b7a28f1d238b0191669';

    // MemeAsset.fileHash has a FK to FileHash.hash in this project.
    await prisma.fileHash.create({
      data: {
        hash: sha,
        filePath: `/uploads/memes/${sha}.webm`,
        referenceCount: 1,
        fileSize: BigInt(1),
        mimeType: 'video/webm',
      },
    });

    // Ensure processOneSubmission can reuse global AI metadata without needing the file on disk.
    await prisma.memeAsset.create({
      data: {
        type: 'video',
        fileUrl: `/uploads/memes/${sha}.webm`,
        fileHash: sha,
        durationMs: 1234,
        poolVisibility: 'visible',
        aiStatus: 'done',
        aiAutoDescription: 'GLOBAL_AI_DESC',
        aiAutoTagNamesJson: ['global_tag_1'] as any,
        aiSearchText: 'GLOBAL_AI_SEARCH',
        aiCompletedAt: new Date(),
      } as any,
      select: { id: true },
    });

    const submission = await prisma.memeSubmission.create({
      data: {
        channelId: channel.id,
        submitterUserId: user.id,
        title: 'Test',
        type: 'video',
        fileUrlTemp: `/uploads/memes/${sha}.webm`,
        sourceKind: 'url',
        status: 'pending',
        fileHash: null,
        durationMs: 1234,
        aiStatus: 'pending',
      } as any,
      select: { id: true },
    });

    // Should not throw "missing_filehash" anymore.
    await processOneSubmission(submission.id);

    const updated = await prisma.memeSubmission.findUnique({
      where: { id: submission.id },
      select: { fileHash: true, aiError: true, aiStatus: true },
    });

    expect(updated?.fileHash).toBe(sha);
    expect(updated?.aiError).not.toBe('missing_filehash');
    expect(updated?.aiStatus).toBe('done');
  });
});


