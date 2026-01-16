import type { ChannelMeme, FileHash, Meme, MemeAsset, Prisma } from '@prisma/client';
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

export async function createMemeAsset(
  overrides: Partial<Prisma.MemeAssetUncheckedCreateInput> = {}
): Promise<MemeAsset> {
  const seed = uniqueId('asset');
  const data: Prisma.MemeAssetUncheckedCreateInput = {
    type: 'video',
    fileUrl: `/uploads/memes/${seed}.webm`,
    durationMs: 1000,
    ...overrides,
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

export async function createMeme(overrides: Partial<Prisma.MemeUncheckedCreateInput> = {}): Promise<Meme> {
  const seed = uniqueId('meme');
  const channelId = overrides.channelId ?? (await createChannel()).id;
  const data: Prisma.MemeUncheckedCreateInput = {
    channelId,
    title: `Meme ${seed}`,
    type: 'video',
    fileUrl: `/uploads/memes/${seed}.webm`,
    durationMs: 1000,
    priceCoins: 100,
    status: 'approved',
    ...overrides,
  };
  return prisma.meme.create({ data });
}
