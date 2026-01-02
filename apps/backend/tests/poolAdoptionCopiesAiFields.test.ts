import { prisma } from '../src/lib/prisma.js';
import { createPoolSubmission } from '../src/controllers/submission/createPoolSubmission.js';

function rand(): string {
  return Math.random().toString(16).slice(2);
}

function mockRes() {
  const res: any = {};
  res.statusCode = 200;
  res.headers = {};
  res.body = undefined;
  res.headersSent = false;
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: any) => {
    res.body = body;
    res.headersSent = true;
    return res;
  };
  return res;
}

describe('Pool owner adoption', () => {
  it('copies AI fields from existing ChannelMeme for the same MemeAsset', async () => {
    const channelA = await prisma.channel.create({
      data: { slug: `ch_${rand()}`, name: `Channel ${rand()}`, defaultPriceCoins: 100 },
      select: { id: true },
    });
    const channelB = await prisma.channel.create({
      data: { slug: `ch_${rand()}`, name: `Channel ${rand()}`, defaultPriceCoins: 100 },
      select: { id: true },
    });

    const streamerB = await prisma.user.create({
      data: { displayName: `Streamer ${rand()}`, role: 'streamer', hasBetaAccess: false, channelId: channelB.id },
      select: { id: true },
    });

    const fileHash = `hash_${rand()}`;
    const fileUrl = `/uploads/memes/${rand()}.webm`;
    // MemeAsset.fileHash has a FK to FileHash.hash in this project.
    await prisma.fileHash.create({
      data: {
        hash: fileHash,
        filePath: fileUrl,
        referenceCount: 1,
        fileSize: BigInt(1),
        mimeType: 'video/webm',
      },
    });

    const asset = await prisma.memeAsset.create({
      data: {
        type: 'video',
        fileUrl,
        fileHash,
        durationMs: 1000,
        createdByUserId: streamerB.id,
        poolVisibility: 'visible',
        aiStatus: 'done',
        aiAutoDescription: 'auto description',
        aiAutoTagNamesJson: ['tag1', 'tag2'] as any,
        aiSearchText: 'auto description search',
        aiCompletedAt: new Date(),
      } as any,
      select: { id: true },
    });

    // Existing adoption (any channel) not required anymore: AI is stored globally on MemeAsset.
    await prisma.channelMeme.create({
      data: {
        channelId: channelA.id,
        memeAssetId: asset.id,
        status: 'approved',
        title: 'Some title A',
        priceCoins: 100,
      } as any,
    });

    const req: any = {
      requestId: `req_${rand()}`,
      userId: streamerB.id,
      userRole: 'streamer',
      channelId: channelB.id, // JWT-scoped channel
      body: { channelId: channelB.id, memeAssetId: asset.id, title: 'Adopted title', notes: null, tags: [] },
      app: { get: () => undefined },
    };
    const res = mockRes();

    await createPoolSubmission(req, res as any);
    expect(res.statusCode).toBe(201);
    expect(res.body?.isDirectApproval).toBe(true);

    const cm = await prisma.channelMeme.findUnique({
      where: { channelId_memeAssetId: { channelId: channelB.id, memeAssetId: asset.id } },
      select: { aiAutoDescription: true, aiAutoTagNamesJson: true, searchText: true },
    });

    expect(cm?.aiAutoDescription).toBe('auto description');
    expect(Array.isArray(cm?.aiAutoTagNamesJson)).toBe(true);
    expect(cm?.searchText).toBe('auto description search');
  });
});


