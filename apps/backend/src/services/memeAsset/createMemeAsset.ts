import type { MemeAsset, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { computeContentHash } from '../../utils/media/contentHash.js';

export type FindOrCreateMemeAssetResult = {
  memeAsset: MemeAsset;
  isExisting: boolean;
  contentHash: string;
};

export async function findOrCreateMemeAsset(params: {
  inputPath: string;
  type: string;
  createdByUserId?: string | null;
  durationMs?: number | null;
  fileUrl?: string | null;
  fileHash?: string | null;
}): Promise<FindOrCreateMemeAssetResult> {
  const contentHash = await computeContentHash(params.inputPath);

  const existing = await prisma.memeAsset.findFirst({
    where: { contentHash },
  });
  if (existing) {
    return { memeAsset: existing, isExisting: true, contentHash };
  }

  try {
    const memeAsset = await prisma.memeAsset.create({
      data: {
        contentHash,
        type: params.type,
        createdByUserId: params.createdByUserId ?? null,
        durationMs: params.durationMs ?? 0,
        fileUrl: params.fileUrl ?? null,
        fileHash: params.fileHash ?? null,
        aiStatus: 'pending',
      },
    });
    return { memeAsset, isExisting: false, contentHash };
  } catch (error) {
    const err = error as Prisma.PrismaClientKnownRequestError | null;
    if (err?.code === 'P2002') {
      const existing = await prisma.memeAsset.findFirst({
        where: { contentHash },
      });
      if (existing) return { memeAsset: existing, isExisting: true, contentHash };
    }
    throw error;
  }
}
