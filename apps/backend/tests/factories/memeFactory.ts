import type { ChannelMeme, FileHash, MemeAsset, Prisma } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { createChannel } from './channelFactory.js';
import { uniqueId } from './utils.js';

export async function createFileHash(overrides: Partial<Prisma.FileHashUncheckedCreateInput> = {}): Promise<FileHash> {
  const seed = uniqueId('filehash');
  const data: Prisma.FileHashUncheckedCreateInput = {
    hash: `hash_${seed}`,
    filePath: `/uploads/memes/${seed}.webm`,
    referenceCount: 1,
    fileSize: BigInt(1),
    mimeType: 'video/webm',
    ...overrides,
  };
  return prisma.fileHash.create({ data });
}

type MemeAssetOverrides = Partial<Prisma.MemeAssetUncheckedCreateInput> & {
  createdByUserId?: string | null;
};

export async function createMemeAsset(overrides: MemeAssetOverrides = {}): Promise<MemeAsset> {
  const seed = uniqueId('asset');
  const { createdByUserId, ...rest } = overrides;
  const data: Prisma.MemeAssetUncheckedCreateInput = {
    type: 'video',
    fileUrl: `/uploads/memes/${seed}.webm`,
    durationMs: 1000,
    ...rest,
    createdById: createdByUserId ?? rest.createdById,
    fileHash: rest.fileHash ?? `hash_${seed}`,
  };
  return prisma.memeAsset.create({ data });
}

export async function createChannelMeme(
  overrides: Partial<Prisma.ChannelMemeUncheckedCreateInput> = {}
): Promise<ChannelMeme> {
  const seed = uniqueId('channelmeme');
  const channelId = overrides.channelId ?? (await createChannel()).id;
  const memeAssetId = overrides.memeAssetId ?? (await createMemeAsset()).id;
  const data: Prisma.ChannelMemeUncheckedCreateInput = {
    channelId,
    memeAssetId,
    status: 'approved',
    title: `Meme ${seed}`,
    priceCoins: 100,
    ...overrides,
  };
  return prisma.channelMeme.create({ data });
}

export type TestMeme = {
  id: string;
  channelId: string;
  memeAssetId: string;
  title: string;
  type: string;
  fileUrl: string;
  durationMs: number;
  priceCoins: number;
  status: string;
  createdAt: Date;
  createdByUserId?: string | null;
};

type TestMemeOverrides = Partial<Prisma.ChannelMemeUncheckedCreateInput> & {
  type?: string;
  fileUrl?: string;
  durationMs?: number;
  fileHash?: string;
  createdByUserId?: string | null;
};

export async function createMeme(overrides: TestMemeOverrides = {}): Promise<TestMeme> {
  const seed = uniqueId('meme');
  const channelId = overrides.channelId ?? (await createChannel()).id;
  const asset = await createMemeAsset({
    type: overrides.type ?? 'video',
    fileUrl: overrides.fileUrl ?? `/uploads/memes/${seed}.webm`,
    durationMs: overrides.durationMs ?? 1000,
    fileHash: overrides.fileHash,
    createdById: overrides.createdByUserId ?? undefined,
  });
  const channelMeme = await createChannelMeme({
    channelId,
    memeAssetId: asset.id,
    title: overrides.title ?? `Meme ${seed}`,
    priceCoins: overrides.priceCoins ?? 100,
    status: overrides.status ?? 'approved',
  });

  return {
    id: channelMeme.id,
    channelId: channelMeme.channelId,
    memeAssetId: channelMeme.memeAssetId,
    title: channelMeme.title,
    type: asset.type,
    fileUrl: asset.fileUrl,
    durationMs: asset.durationMs,
    priceCoins: channelMeme.priceCoins,
    status: channelMeme.status,
    createdAt: channelMeme.createdAt,
    createdByUserId: overrides.createdByUserId ?? null,
  };
}
