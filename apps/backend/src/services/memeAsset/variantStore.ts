import { prisma } from '../../lib/prisma.js';
import { decrementFileHashReference, findOrCreateFileHash, getFileHashByPath } from '../../utils/fileHash.js';

export async function upsertMemeAssetVariant(params: {
  memeAssetId: string;
  format: 'preview' | 'webm' | 'mp4';
  mimeType: string;
  outputPath: string;
  fileHash: string;
  fileSizeBytes: number;
  priority: number;
}): Promise<{ fileUrl: string }> {
  const fileSizeBigint = BigInt(params.fileSizeBytes);
  const existing = await prisma.memeAssetVariant.findUnique({
    where: { memeAssetId_format: { memeAssetId: params.memeAssetId, format: params.format } },
    select: { fileUrl: true },
  });

  const existingFileUrl = existing?.fileUrl ? String(existing.fileUrl) : '';
  const existingHash = existingFileUrl ? await getFileHashByPath(existingFileUrl) : null;
  if (existingHash && existingHash === params.fileHash && existingFileUrl) {
    await prisma.memeAssetVariant.update({
      where: { memeAssetId_format: { memeAssetId: params.memeAssetId, format: params.format } },
      data: {
        fileSizeBytes: fileSizeBigint,
        status: 'done',
        priority: params.priority,
      },
    });
    return { fileUrl: existingFileUrl };
  }

  const stored = await findOrCreateFileHash(params.outputPath, params.fileHash, params.mimeType, fileSizeBigint);
  if (existingHash && existingHash !== params.fileHash) {
    try {
      await decrementFileHashReference(existingHash);
    } catch {
      // ignore
    }
  }

  await prisma.memeAssetVariant.upsert({
    where: { memeAssetId_format: { memeAssetId: params.memeAssetId, format: params.format } },
    create: {
      memeAssetId: params.memeAssetId,
      format: params.format,
      fileUrl: stored.filePath,
      fileSizeBytes: fileSizeBigint,
      status: 'done',
      priority: params.priority,
    },
    update: {
      fileUrl: stored.filePath,
      fileSizeBytes: fileSizeBigint,
      status: 'done',
      priority: params.priority,
    },
  });

  return { fileUrl: stored.filePath };
}

export async function markVariantFailed(params: {
  memeAssetId: string;
  format: 'preview' | 'webm' | 'mp4';
}): Promise<void> {
  await prisma.memeAssetVariant.upsert({
    where: { memeAssetId_format: { memeAssetId: params.memeAssetId, format: params.format } },
    create: {
      memeAssetId: params.memeAssetId,
      format: params.format,
      fileUrl: '',
      status: 'failed',
      priority: params.format === 'webm' ? 0 : params.format === 'mp4' ? 1 : 2,
    },
    update: {
      status: 'failed',
      priority: params.format === 'webm' ? 0 : params.format === 'mp4' ? 1 : 2,
    },
  });
}
