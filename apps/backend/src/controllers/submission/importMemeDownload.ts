import fs from 'fs';
import path from 'path';
import { calculateFileHash, downloadFileFromUrl, findOrCreateFileHash, getFileStats } from '../../utils/fileHash.js';
import { detectFileTypeByMagicBytes } from '../../utils/fileTypeValidator.js';
import { getVideoMetadata } from '../../utils/videoValidator.js';
import { transcodeToFormat } from '../../utils/media/videoNormalization.js';
import { computeContentHash } from '../../utils/media/contentHash.js';
import { safeUnlink } from './importMemeHelpers.js';

export type ImportFileResult = {
  finalFilePath: string;
  fileHash: string | null;
  contentHash: string | null;
  detectedDurationMs: number | null;
  fileHashForCleanup: string | null;
  fileHashRefAdded: boolean;
};

export async function downloadAndPrepareImportFile(sourceUrl: string): Promise<ImportFileResult> {
  let tempFilePath: string | null = null;
  let tempFileForCleanup: string | null = null;
  let finalFilePath: string | null = null;
  let fileHash: string | null = null;
  let contentHash: string | null = null;
  let detectedDurationMs: number | null = null;
  let fileHashForCleanup: string | null = null;
  let fileHashRefAdded = false;

  try {
    tempFilePath = await downloadFileFromUrl(sourceUrl);

    const detectedType = await detectFileTypeByMagicBytes(tempFilePath);
    if (!detectedType || !detectedType.startsWith('video/')) {
      await safeUnlink(tempFilePath);
      throw Object.assign(new Error('Invalid file content'), {
        code: 'INVALID_FILE_CONTENT',
        details: { detectedType },
      });
    }

    const stat = await fs.promises.stat(tempFilePath);
    const MAX_SIZE = 50 * 1024 * 1024;
    if (stat.size > MAX_SIZE) {
      await safeUnlink(tempFilePath);
      throw Object.assign(new Error('File too large'), {
        code: 'FILE_TOO_LARGE',
        details: { maxBytes: MAX_SIZE, sizeBytes: stat.size },
      });
    }

    const metadata = await getVideoMetadata(tempFilePath);
    const durationSec = metadata?.duration && metadata.duration > 0 ? metadata.duration : null;
    const durationMs = durationSec !== null ? Math.round(durationSec * 1000) : null;
    detectedDurationMs = durationMs;
    if (durationMs !== null && durationMs > 15000) {
      await safeUnlink(tempFilePath);
      throw Object.assign(new Error('Video is too long'), {
        code: 'VIDEO_TOO_LONG',
        details: { maxDurationMs: 15000, durationMs },
      });
    }

    contentHash = await computeContentHash(tempFilePath);
    const baseName = `import-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const outputDir = path.dirname(tempFilePath);
    const normalized = await transcodeToFormat(tempFilePath, outputDir, 'mp4', baseName);
    const normalizedPath = normalized.outputPath;

    if (normalizedPath !== tempFilePath) {
      await safeUnlink(tempFilePath);
    }
    tempFileForCleanup = normalizedPath;

    if (normalized.durationMs !== null) {
      detectedDurationMs = normalized.durationMs;
      if (detectedDurationMs > 15000) {
        await safeUnlink(normalizedPath);
        throw Object.assign(new Error('Video is too long'), {
          code: 'VIDEO_TOO_LONG',
          details: { maxDurationMs: 15000, durationMs: detectedDurationMs },
        });
      }
    }

    const normalizedStat = await fs.promises.stat(normalizedPath);
    if (normalizedStat.size > MAX_SIZE) {
      await safeUnlink(normalizedPath);
      throw Object.assign(new Error('File too large'), {
        code: 'FILE_TOO_LARGE',
        details: { maxBytes: MAX_SIZE, sizeBytes: normalizedStat.size },
      });
    }

    const hash = normalized.fileHash ?? (await calculateFileHash(normalizedPath));
    const stats = await getFileStats(normalizedPath);
    const dedup = await findOrCreateFileHash(normalizedPath, hash, stats.mimeType, stats.size);
    finalFilePath = dedup.filePath;
    fileHash = hash;
    fileHashForCleanup = hash;
    fileHashRefAdded = true;
    tempFileForCleanup = null;
  } catch (error) {
    if (tempFileForCleanup) {
      await safeUnlink(tempFileForCleanup);
    } else if (tempFilePath) {
      await safeUnlink(tempFilePath);
    }
    throw error;
  }

  if (!finalFilePath) {
    throw Object.assign(new Error('Upload failed'), { code: 'UPLOAD_FAILED' });
  }

  return {
    finalFilePath,
    fileHash,
    contentHash,
    detectedDurationMs,
    fileHashForCleanup,
    fileHashRefAdded,
  };
}
