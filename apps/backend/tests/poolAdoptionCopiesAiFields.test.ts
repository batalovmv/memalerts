import type { Response } from 'express';
import type { AuthRequest } from '../src/middleware/auth.js';
import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { createPoolSubmission } from '../src/controllers/submission/createPoolSubmission.js';
import { createChannel, createChannelMeme, createFileHash, createMemeAsset, createUser } from './factories/index.js';

function rand(): string {
  return Math.random().toString(16).slice(2);
}

type MockResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  headersSent: boolean;
  status: (code: number) => MockResponse;
  json: (body: unknown) => MockResponse;
};

function mockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    headers: {},
    body: undefined,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      this.headersSent = true;
      return this;
    },
  };
  return res;
}

describe('Pool owner adoption', () => {
  it('copies AI fields from existing ChannelMeme for the same MemeAsset', async () => {
    const channelA = await createChannel({
      slug: `ch_${rand()}`,
      name: `Channel ${rand()}`,
      defaultPriceCoins: 100,
    });
    const channelB = await createChannel({
      slug: `ch_${rand()}`,
      name: `Channel ${rand()}`,
      defaultPriceCoins: 100,
    });

    const streamerB = await createUser({
      displayName: `Streamer ${rand()}`,
      role: 'streamer',
      hasBetaAccess: false,
      channelId: channelB.id,
    });

    const fileHash = `hash_${rand()}`;
    const fileUrl = `/uploads/memes/${rand()}.webm`;
    // MemeAsset.fileHash has a FK to FileHash.hash in this project.
    await createFileHash({
      hash: fileHash,
      filePath: fileUrl,
      referenceCount: 1,
      fileSize: BigInt(1),
      mimeType: 'video/webm',
    });

    const assetData = {
      type: 'video',
      fileUrl,
      fileHash,
      durationMs: 1000,
      createdByUserId: streamerB.id,
      poolVisibility: 'visible',
      aiStatus: 'done',
      aiAutoDescription: 'auto description',
      aiAutoTagNamesJson: ['tag1', 'tag2'],
      aiSearchText: 'auto description search',
      aiCompletedAt: new Date(),
    } satisfies Prisma.MemeAssetCreateInput;
    const asset = await createMemeAsset(assetData);

    // Existing adoption (any channel) not required anymore: AI is stored globally on MemeAsset.
    const channelMemeData = {
      channelId: channelA.id,
      memeAssetId: asset.id,
      status: 'approved',
      title: 'Some title A',
      priceCoins: 100,
    } satisfies Prisma.ChannelMemeCreateInput;
    await createChannelMeme(channelMemeData);

    const req = {
      requestId: `req_${rand()}`,
      userId: streamerB.id,
      userRole: 'streamer',
      channelId: channelB.id, // JWT-scoped channel
      body: { channelId: channelB.id, memeAssetId: asset.id, title: 'Adopted title', notes: null, tags: [] },
      app: { get: () => undefined },
    } as AuthRequest;
    const res = mockRes();

    await createPoolSubmission(req, res as unknown as Response);
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
