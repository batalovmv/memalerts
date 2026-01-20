import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { processOneSubmission } from '../src/jobs/aiModerationSubmissions.js';
import {
  createChannel,
  createChannelMeme,
  createFileHash,
  createMemeAsset,
  createSubmission,
  createUser,
} from './factories/index.js';

function rand(): string {
  return Math.random().toString(16).slice(2);
}

describe('AI moderation dedup via MemeAsset (fileHash)', () => {
  it('reuses MemeAsset AI metadata for duplicate submissions (no re-analysis)', async () => {
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

    const fileHash = `hash_${rand()}`;

    // MemeAsset.fileHash has a FK to FileHash.hash in this project.
    await createFileHash({
      hash: fileHash,
      filePath: `/uploads/memes/${rand()}.webm`,
      referenceCount: 1,
      fileSize: BigInt(1),
      mimeType: 'video/webm',
    });

    const assetData = {
      type: 'video',
      fileUrl: `/uploads/memes/${rand()}.webm`,
      fileHash,
      durationMs: 1234,
      poolVisibility: 'visible',
      aiStatus: 'done',
      aiAutoDescription: 'GLOBAL_AI_DESC',
      aiAutoTagNamesJson: ['global_tag_1'],
      aiSearchText: 'GLOBAL_AI_SEARCH',
      aiCompletedAt: new Date(),
    } satisfies Prisma.MemeAssetCreateInput;
    const asset = await createMemeAsset(assetData);

    const channelMemeData = {
      channelId: channel.id,
      memeAssetId: asset.id,
      status: 'approved',
      title: 'Title',
      priceCoins: 100,
    } satisfies Prisma.ChannelMemeCreateInput;
    await createChannelMeme(channelMemeData);

    const submissionData = {
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
    } satisfies Prisma.MemeSubmissionCreateInput;
    const submission = await createSubmission(submissionData);

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
