import { prisma } from '../../lib/prisma.js';
import { decrementFileHashReference, findOrCreateFileHash } from '../../utils/fileHash.js';

export async function upsertMemeAssetVariant(params: {
  memeAssetId: string;
  format: 'preview' | 'webm' | 'mp4';
  codec: string;
  container: string;
  mimeType: string;
  outputPath: string;
  fileHash: string;
  fileSizeBytes: number;
  durationMs: number | null;
  width: number | undefined;
  height: number | undefined;
  priority: number;
}): Promise<{ fileUrl: string }> {
  const fileSizeBigint = BigInt(params.fileSizeBytes);
  const existing = await prisma.memeAssetVariant.findUnique({
    where: { memeAssetId_format: { memeAssetId: params.memeAssetId, format: params.format } },
    select: { fileHash: true, fileUrl: true },
  });

  if (existing?.fileHash && existing.fileHash === params.fileHash && existing.fileUrl) {
    await prisma.memeAssetVariant.update({
      where: { memeAssetId_format: { memeAssetId: params.memeAssetId, format: params.format } },
      data: {
        codec: params.codec,
        container: params.container,
        mimeType: params.mimeType,
        durationMs: params.durationMs ?? null,
        width: params.width ?? null,
        height: params.height ?? null,
        fileSizeBytes: fileSizeBigint,
        status: 'done',
        priority: params.priority,
        completedAt: new Date(),
        errorMessage: null,
        retryCount: 0,
        lastTriedAt: new Date(),
      },
    });
    return { fileUrl: existing.fileUrl };
  }

  const stored = await findOrCreateFileHash(params.outputPath, params.fileHash, params.mimeType, fileSizeBigint);
  if (existing?.fileHash && existing.fileHash !== params.fileHash) {
    try {
      await decrementFileHashReference(existing.fileHash);
    } catch {
      // ignore
    }
  }

  await prisma.memeAssetVariant.upsert({
    where: { memeAssetId_format: { memeAssetId: params.memeAssetId, format: params.format } },
    create: {
      memeAssetId: params.memeAssetId,
      format: params.format,
      codec: params.codec,
      container: params.container,
      mimeType: params.mimeType,
      fileUrl: stored.filePath,
      fileHash: params.fileHash,
      fileSizeBytes: fileSizeBigint,
      durationMs: params.durationMs ?? null,
      width: params.width ?? null,
      height: params.height ?? null,
      status: 'done',
      priority: params.priority,
      completedAt: new Date(),
    },
    update: {
      codec: params.codec,
      container: params.container,
      mimeType: params.mimeType,
      fileUrl: stored.filePath,
      fileHash: params.fileHash,
      fileSizeBytes: fileSizeBigint,
      durationMs: params.durationMs ?? null,
      width: params.width ?? null,
      height: params.height ?? null,
      status: 'done',
      priority: params.priority,
      completedAt: new Date(),
      errorMessage: null,
      retryCount: 0,
      lastTriedAt: new Date(),
    },
  });

  return { fileUrl: stored.filePath };
}

export async function markVariantFailed(params: {
  memeAssetId: string;
  format: 'preview' | 'webm' | 'mp4';
  errorMessage: string;
}): Promise<void> {
  await prisma.memeAssetVariant.upsert({
    where: { memeAssetId_format: { memeAssetId: params.memeAssetId, format: params.format } },
    create: {
      memeAssetId: params.memeAssetId,
      format: params.format,
      codec: '',
      container: '',
      mimeType: '',
      fileUrl: '',
      status: 'failed',
      priority: params.format === 'webm' ? 0 : params.format === 'mp4' ? 1 : 2,
      errorMessage: params.errorMessage,
      retryCount: 1,
      lastTriedAt: new Date(),
    },
    update: {
      status: 'failed',
      errorMessage: params.errorMessage,
      retryCount: { increment: 1 },
      lastTriedAt: new Date(),
    },
  });
}
