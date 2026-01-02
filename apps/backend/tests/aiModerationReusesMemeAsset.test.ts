import { prisma } from '../src/lib/prisma.js';
import { processOneSubmission } from '../src/jobs/aiModerationSubmissions.js';

function rand(): string {
  return Math.random().toString(16).slice(2);
}

describe('AI moderation dedup via MemeAsset (fileHash)', () => {
  it('reuses MemeAsset AI metadata for duplicate submissions (no re-analysis)', async () => {
    const channel = await prisma.channel.create({
      data: { slug: `ch_${rand()}`, name: `Channel ${rand()}`, defaultPriceCoins: 100 },
      select: { id: true },
    });

    const user = await prisma.user.create({
      data: { displayName: `User ${rand()}`, role: 'viewer', hasBetaAccess: false, channelId: null },
      select: { id: true },
    });

    const fileHash = `hash_${rand()}`;

    // MemeAsset.fileHash has a FK to FileHash.hash in this project.
    await prisma.fileHash.create({
      data: {
        hash: fileHash,
        filePath: `/uploads/memes/${rand()}.webm`,
        referenceCount: 1,
        fileSize: BigInt(1),
        mimeType: 'video/webm',
      },
    });

    const asset = await prisma.memeAsset.create({
      data: {
        type: 'video',
        fileUrl: `/uploads/memes/${rand()}.webm`,
        fileHash,
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

    await prisma.channelMeme.create({
      data: {
        channelId: channel.id,
        memeAssetId: asset.id,
        status: 'approved',
        title: 'Title',
        priceCoins: 100,
      } as any,
    });

    const submission = await prisma.memeSubmission.create({
      data: {
        channelId: channel.id,
        submitterUserId: user.id,
        title: 'This title would produce different heuristic output',
        type: 'video',
        fileUrlTemp: '/uploads/memes/does-not-need-to-exist.webm',
        sourceKind: 'upload',
        status: 'pending',
        memeAssetId: asset.id,
        fileHash,
        durationMs: 1234,
        aiStatus: 'pending',
      } as any,
      select: { id: true },
    });

    await processOneSubmission(submission.id);

    const updatedSubmission = await prisma.memeSubmission.findUnique({
      where: { id: submission.id },
      select: { aiStatus: true, aiAutoDescription: true, aiAutoTagNamesJson: true },
    });

    expect(updatedSubmission?.aiStatus).toBe('done');
    expect(updatedSubmission?.aiAutoDescription).toBe('GLOBAL_AI_DESC');
    expect(Array.isArray(updatedSubmission?.aiAutoTagNamesJson)).toBe(true);

    const updatedChannelMeme = await prisma.channelMeme.findUnique({
      where: { channelId_memeAssetId: { channelId: channel.id, memeAssetId: asset.id } },
      select: { aiAutoDescription: true, aiAutoTagNamesJson: true, searchText: true },
    });

    expect(updatedChannelMeme?.aiAutoDescription).toBe('GLOBAL_AI_DESC');
    expect(updatedChannelMeme?.searchText).toBe('GLOBAL_AI_SEARCH');
    expect(Array.isArray(updatedChannelMeme?.aiAutoTagNamesJson)).toBe(true);
  });
});


