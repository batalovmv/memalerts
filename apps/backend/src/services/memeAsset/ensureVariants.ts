import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma.js';
import { calculateFileHash, getFileStats } from '../../utils/fileHash.js';
import { getVideoMetadata } from '../../utils/videoValidator.js';
import { logger } from '../../utils/logger.js';
import { resolveLocalMediaPath } from '../../utils/media/resolveMediaPath.js';
import { VIDEO_FORMATS } from '../../utils/media/videoFormats.js';
import { transcodeToFormat, transcodeToPreview } from '../../utils/media/videoNormalization.js';
import { enqueueTranscode } from '../../queues/transcodeQueue.js';
import { upsertMemeAssetVariant } from './variantStore.js';

type EnsureVariantsParams = {
  memeAssetId: string;
  sourceFileUrl: string;
  sourceFileHash?: string | null;
  sourceDurationMs?: number | null;
};

type FallbackSource = {
  url: string;
  format: 'mp4' | 'webm';
};

function getFileExt(fileUrl: string | null | undefined): string {
  const raw = String(fileUrl ?? '').trim();
  if (!raw) return '';
  try {
    return path.extname(new URL(raw).pathname).toLowerCase();
  } catch {
    return path.extname(raw).toLowerCase();
  }
}

function toMs(durationSec?: number | null): number | null {
  if (!Number.isFinite(durationSec as number)) return null;
  const value = Number(durationSec);
  return value > 0 ? Math.round(value * 1000) : null;
}

async function ensureFileHashReference(hash: string, fileUrl: string, localPath: string): Promise<void> {
  if (!hash || !fileUrl) return;
  try {
    const stats = await getFileStats(localPath);
    await prisma.fileHash.upsert({
      where: { hash },
      create: {
        hash,
        filePath: fileUrl,
        referenceCount: 1,
        fileSize: stats.size,
        mimeType: stats.mimeType,
      },
      update: {
        filePath: fileUrl,
        fileSize: stats.size,
        mimeType: stats.mimeType,
        referenceCount: { increment: 1 },
      },
    });
  } catch (error) {
    const err = error as Error;
    logger.warn('filehash.ensure_failed', { hash, errorMessage: err.message || String(error) });
  }
}

async function ensureMp4Variant(params: {
  memeAssetId: string;
  fileUrl: string;
  fileHash: string | null;
  fileSizeBytes: number | null;
  durationMs: number | null;
  width?: number;
  height?: number;
}): Promise<void> {
  const now = new Date();
  await prisma.memeAssetVariant.upsert({
    where: { memeAssetId_format: { memeAssetId: params.memeAssetId, format: 'mp4' } },
    create: {
      memeAssetId: params.memeAssetId,
      format: 'mp4',
      codec: VIDEO_FORMATS.mp4.codecString,
      container: VIDEO_FORMATS.mp4.container,
      mimeType: VIDEO_FORMATS.mp4.mimeType,
      fileUrl: params.fileUrl,
      fileHash: params.fileHash ?? null,
      fileSizeBytes: params.fileSizeBytes !== null ? BigInt(params.fileSizeBytes) : null,
      durationMs: params.durationMs ?? null,
      width: params.width ?? null,
      height: params.height ?? null,
      status: 'done',
      priority: VIDEO_FORMATS.mp4.priority,
      completedAt: now,
    },
    update: {
      fileUrl: params.fileUrl,
      fileHash: params.fileHash ?? null,
      fileSizeBytes: params.fileSizeBytes !== null ? BigInt(params.fileSizeBytes) : null,
      durationMs: params.durationMs ?? null,
      width: params.width ?? null,
      height: params.height ?? null,
      status: 'done',
      priority: VIDEO_FORMATS.mp4.priority,
      completedAt: now,
      errorMessage: null,
      retryCount: 0,
      lastTriedAt: now,
    },
  });
}

async function ensurePendingVariant(params: { memeAssetId: string; format: 'preview' | 'webm' | 'mp4' }) {
  const config = VIDEO_FORMATS[params.format];
  await prisma.memeAssetVariant.upsert({
    where: { memeAssetId_format: { memeAssetId: params.memeAssetId, format: params.format } },
    create: {
      memeAssetId: params.memeAssetId,
      format: params.format,
      codec: config.codecString,
      container: config.container,
      mimeType: config.mimeType,
      fileUrl: '',
      status: 'pending',
      priority: config.priority,
    },
    update: {
      status: 'pending',
      errorMessage: null,
      priority: config.priority,
    },
  });
}

function pickFallbackSource(
  existing: Array<{ format: string; status: string; fileUrl: string }>
): FallbackSource | null {
  const order: FallbackSource['format'][] = ['mp4', 'webm'];
  for (const format of order) {
    const candidate = existing.find(
      (item) => String(item.format || '') === format && String(item.status || '') === 'done' && item.fileUrl
    );
    if (candidate?.fileUrl) {
      return { url: candidate.fileUrl, format };
    }
  }
  return null;
}

export async function ensureMemeAssetVariants(params: EnsureVariantsParams): Promise<void> {
  const memeAssetId = String(params.memeAssetId || '').trim();
  if (!memeAssetId) return;
  const sourceFileUrl = String(params.sourceFileUrl || '').trim();
  if (!sourceFileUrl) return;

  const existing = await prisma.memeAssetVariant.findMany({
    where: { memeAssetId },
    select: { format: true, status: true, fileUrl: true },
  });
  const byFormat = new Map(existing.map((v) => [String(v.format), v]));
  const hasDone = (format: string) => byFormat.get(format)?.status === 'done';
  const mp4Variant = byFormat.get('mp4');
  const hasValidMp4 =
    mp4Variant?.status === 'done' && getFileExt(mp4Variant.fileUrl) === '.mp4';

  let resolved = await resolveLocalMediaPath(sourceFileUrl);
  let resolvedSourceUrl = sourceFileUrl;
  let fallbackSource: FallbackSource | null = null;
  let usedFallback = false;

  if (!resolved) {
    fallbackSource = pickFallbackSource(existing);
    if (fallbackSource?.url && fallbackSource.url !== sourceFileUrl) {
      const resolvedFallback = await resolveLocalMediaPath(fallbackSource.url);
      if (resolvedFallback) {
        resolved = resolvedFallback;
        resolvedSourceUrl = fallbackSource.url;
        usedFallback = true;
        logger.warn('memeasset.variants.source_fallback', {
          memeAssetId,
          sourceFileUrl,
          fallbackUrl: fallbackSource.url,
          fallbackFormat: fallbackSource.format,
        });
      } else {
        logger.warn('memeasset.variants.source_missing', {
          memeAssetId,
          sourceFileUrl,
          fallbackUrl: fallbackSource.url,
        });
        return;
      }
    } else {
      logger.warn('memeasset.variants.source_missing', { memeAssetId, sourceFileUrl });
      return;
    }
  }

  const localPath = resolved.localPath;
  const cleanupSource = resolved.cleanup;
  const tempDirs: string[] = [];

  try {
    const metadata = await getVideoMetadata(localPath).catch(() => null);
    const durationMs = params.sourceDurationMs ?? toMs(metadata?.duration ?? null);
    const width = metadata?.width;
    const height = metadata?.height;
    const fileSizeBytes =
      metadata?.size ??
      (await fs.promises
        .stat(localPath)
        .then((stat) => stat.size)
        .catch(() => null));

    let fileHash = params.sourceFileHash ?? null;
    if (!fileHash) {
      try {
        fileHash = await calculateFileHash(localPath);
      } catch {
        fileHash = null;
      }
    }

    if (fileHash && !params.sourceFileHash) {
      await ensureFileHashReference(fileHash, resolvedSourceUrl, localPath);
    }

    if (!hasValidMp4) {
      const isMp4Source = path.extname(localPath).toLowerCase() === '.mp4';
      if (isMp4Source) {
        await ensureMp4Variant({
          memeAssetId,
          fileUrl: resolvedSourceUrl,
          fileHash,
          fileSizeBytes: Number.isFinite(fileSizeBytes as number) ? Number(fileSizeBytes) : null,
          durationMs,
          width,
          height,
        });
      } else {
        const queued = await enqueueTranscode({
          memeAssetId,
          inputFileUrl: resolvedSourceUrl,
          format: 'mp4',
        });

        if (queued.enqueued || queued.jobId) {
          await ensurePendingVariant({ memeAssetId, format: 'mp4' });
        } else {
          const tempDir = await fs.promises.mkdtemp(path.join(process.cwd(), 'uploads', 'temp', 'mp4-'));
          tempDirs.push(tempDir);
          const baseName = `meme-${memeAssetId}-${Date.now()}`;
          const result = await transcodeToFormat(localPath, tempDir, 'mp4', baseName);
          await upsertMemeAssetVariant({
            memeAssetId,
            format: 'mp4',
            codec: VIDEO_FORMATS.mp4.codecString,
            container: VIDEO_FORMATS.mp4.container,
            mimeType: VIDEO_FORMATS.mp4.mimeType,
            outputPath: result.outputPath,
            fileHash: result.fileHash,
            fileSizeBytes: result.fileSizeBytes,
            durationMs: result.durationMs,
            width: result.width,
            height: result.height,
            priority: VIDEO_FORMATS.mp4.priority,
          });
        }
      }
    }

    const sourceFileUrlForUpdate = usedFallback ? resolvedSourceUrl : sourceFileUrl;
    if (sourceFileUrlForUpdate) {
      await prisma.memeAsset.updateMany({
        where: { id: memeAssetId, OR: [{ fileUrl: null }, { fileHash: null }, { durationMs: 0 }] },
        data: {
          fileUrl: sourceFileUrlForUpdate,
          fileHash: fileHash ?? undefined,
          durationMs: durationMs ?? undefined,
        },
      });
    }

    if (!hasDone('preview')) {
      const queued = await enqueueTranscode({
        memeAssetId,
        inputFileUrl: resolvedSourceUrl,
        format: 'preview',
      });

      if (queued.enqueued || queued.jobId) {
        await ensurePendingVariant({ memeAssetId, format: 'preview' });
      } else {
        const tempDir = await fs.promises.mkdtemp(path.join(process.cwd(), 'uploads', 'temp', 'preview-'));
        tempDirs.push(tempDir);
        const baseName = `meme-${memeAssetId}-${Date.now()}`;
        const result = await transcodeToPreview(localPath, tempDir, baseName);
        await upsertMemeAssetVariant({
          memeAssetId,
          format: 'preview',
          codec: VIDEO_FORMATS.preview.codecString,
          container: VIDEO_FORMATS.preview.container,
          mimeType: VIDEO_FORMATS.preview.mimeType,
          outputPath: result.outputPath,
          fileHash: result.fileHash,
          fileSizeBytes: result.fileSizeBytes,
          durationMs: result.durationMs,
          width: result.width,
          height: result.height,
          priority: VIDEO_FORMATS.preview.priority,
        });
      }
    }

    if (!hasDone('webm')) {
      const queued = await enqueueTranscode({
        memeAssetId,
        inputFileUrl: resolvedSourceUrl,
        format: 'webm',
      });

      if (queued.enqueued || queued.jobId) {
        await ensurePendingVariant({ memeAssetId, format: 'webm' });
      } else {
        const tempDir = await fs.promises.mkdtemp(path.join(process.cwd(), 'uploads', 'temp', 'webm-'));
        tempDirs.push(tempDir);
        const baseName = `meme-${memeAssetId}-${Date.now()}`;
        const result = await transcodeToFormat(localPath, tempDir, 'webm', baseName);
        await upsertMemeAssetVariant({
          memeAssetId,
          format: 'webm',
          codec: VIDEO_FORMATS.webm.codecString,
          container: VIDEO_FORMATS.webm.container,
          mimeType: VIDEO_FORMATS.webm.mimeType,
          outputPath: result.outputPath,
          fileHash: result.fileHash,
          fileSizeBytes: result.fileSizeBytes,
          durationMs: result.durationMs,
          width: result.width,
          height: result.height,
          priority: VIDEO_FORMATS.webm.priority,
        });
      }
    }
  } catch (error) {
    const err = error as Error;
    logger.warn('memeasset.variants.ensure_failed', { memeAssetId, errorMessage: err?.message || String(error) });
  } finally {
    try {
      await cleanupSource();
    } catch {
      // ignore
    }
    for (const dir of tempDirs) {
      try {
        await fs.promises.rm(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}
