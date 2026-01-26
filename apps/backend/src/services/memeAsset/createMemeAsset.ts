import type { MemeAsset, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { calculateFileHash } from '../../utils/fileHash.js';

export type FindOrCreateMemeAssetResult = {
  memeAsset: MemeAsset;
  isExisting: boolean;
  fileHash: string;
};

export async function findOrCreateMemeAsset(params: {
  inputPath: string;
  type: string;
  createdByUserId?: string | null;
  durationMs?: number | null;
  fileUrl: string;
  fileHash?: string | null;
}): Promise<FindOrCreateMemeAssetResult> {
  const resolvedFileHash = params.fileHash ?? (await calculateFileHash(params.inputPath));

  const existing = await prisma.memeAsset.findFirst({
    where: { fileHash: resolvedFileHash },
  });
  if (existing) {
    return { memeAsset: existing, isExisting: true, fileHash: resolvedFileHash };
  }

  try {
    const memeAsset = await prisma.memeAsset.create({
      data: {
        type: params.type,
        createdById: params.createdByUserId ?? null,
        durationMs: params.durationMs ?? 0,
        fileUrl: params.fileUrl,
        fileHash: resolvedFileHash,
        aiStatus: 'pending',
      },
    });
    return { memeAsset, isExisting: false, fileHash: resolvedFileHash };
  } catch (error) {
    const err = error as Prisma.PrismaClientKnownRequestError | null;
    if (err?.code === 'P2002') {
      const existing = await prisma.memeAsset.findFirst({
        where: { fileHash: resolvedFileHash },
      });
      if (existing) return { memeAsset: existing, isExisting: true, fileHash: resolvedFileHash };
    }
    throw error;
  }
}
