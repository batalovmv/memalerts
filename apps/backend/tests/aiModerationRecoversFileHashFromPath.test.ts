import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { processOneSubmission } from '../src/jobs/aiModerationSubmissions.js';
import { createChannel, createFileHash, createMemeAsset, createSubmission, createUser } from './factories/index.js';

function rand(): string {
  return Math.random().toString(16).slice(2);
}

describe('AI moderation recovers fileHash from fileUrlTemp when missing', () => {
  it('derives sha256 from /uploads/memes/<sha256>.<ext> and does not fail with missing_filehash', async () => {
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

    const sha = '5ac5120e3b9ace2f3447444b42250a74a2925bcc75361b7a28f1d238b0191669';

    // MemeAsset.fileHash has a FK to FileHash.hash in this project.
    await createFileHash({
      hash: sha,
      filePath: `/uploads/memes/${sha}.webm`,
      referenceCount: 1,
      fileSize: BigInt(1),
      mimeType: 'video/webm',
    });

    // Ensure processOneSubmission can reuse global AI metadata without needing the file on disk.
    const assetData = {
      type: 'video',
      fileUrl: `/uploads/memes/${sha}.webm`,
      fileHash: sha,
      durationMs: 1234,
      status: 'active',
      aiStatus: 'done',
      aiAutoDescription: 'GLOBAL_AI_DESC',
      aiAutoTagNames: ['global_tag_1'],
      aiSearchText: 'GLOBAL_AI_SEARCH',
      aiCompletedAt: new Date(),
    } satisfies Prisma.MemeAssetCreateInput;
    await createMemeAsset(assetData);

    const submissionData = {
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
    } satisfies Prisma.MemeSubmissionCreateInput;
    const submission = await createSubmission(submissionData);

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
