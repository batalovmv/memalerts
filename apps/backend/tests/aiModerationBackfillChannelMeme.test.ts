import fs from 'fs';
import path from 'path';
import { prisma } from '../src/lib/prisma.js';
import { processOneSubmission } from '../src/jobs/aiModerationSubmissions.js';

function rand(): string {
  return Math.random().toString(16).slice(2);
}

describe('AI moderation backfill into ChannelMeme', () => {
  it('processes approved upload submissions and copies aiAuto* + searchText into ChannelMeme', async () => {
    const channel = await prisma.channel.create({
      data: { slug: `ch_${rand()}`, name: `Channel ${rand()}`, defaultPriceCoins: 100 },
      select: { id: true },
    });

    const user = await prisma.user.create({
      data: { displayName: `Streamer ${rand()}`, role: 'streamer', hasBetaAccess: false, channelId: channel.id },
      select: { id: true },
    });

    const fileName = `ai-${rand()}.webm`;
    const fileUrl = `/uploads/memes/${fileName}`;
    const uploadsRoot = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads');
    const localPath = path.join(uploadsRoot, 'memes', fileName);
    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await fs.promises.writeFile(localPath, Buffer.from('dummy'));

    const fileHash = `hash_${rand()}`;

    const memeAsset = await prisma.memeAsset.create({
      data: {
        type: 'video',
        fileUrl,
        fileHash,
        durationMs: 1000,
        createdByUserId: user.id,
      },
      select: { id: true },
    });

    const channelMeme = await prisma.channelMeme.create({
      data: {
        channelId: channel.id,
        memeAssetId: memeAsset.id,
        status: 'approved',
        title: 'Initial title',
        priceCoins: 100,
        addedByUserId: user.id,
        approvedByUserId: user.id,
        approvedAt: new Date(),
      },
      select: { id: true },
    });

    const submission = await prisma.memeSubmission.create({
      data: {
        channelId: channel.id,
        submitterUserId: user.id,
        title: 'nsfw test',
        type: 'video',
        fileUrlTemp: fileUrl,
        sourceKind: 'upload',
        status: 'approved',
        memeAssetId: memeAsset.id,
        fileHash,
        durationMs: 1000,
        aiStatus: 'pending',
      } as any,
      select: { id: true },
    });

    await processOneSubmission(submission.id);

    const updated = await prisma.channelMeme.findUnique({
      where: { id: channelMeme.id },
      select: { aiAutoDescription: true, aiAutoTagNamesJson: true, searchText: true },
    });

    expect(typeof updated?.aiAutoDescription).toBe('string');
    expect(Array.isArray(updated?.aiAutoTagNamesJson)).toBe(true);
    expect(typeof updated?.searchText).toBe('string');

    // Cleanup file best-effort (avoid polluting workspace in repeated test runs).
    try {
      await fs.promises.unlink(localPath);
    } catch {
      // ignore
    }
  });
});


