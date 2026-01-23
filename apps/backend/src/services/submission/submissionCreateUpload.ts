import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import fs from 'fs';
import path from 'path';
import { calculateFileHash, findOrCreateFileHash, getFileStats } from '../../utils/fileHash.js';
import { validateFileContent } from '../../utils/fileTypeValidator.js';
import { logSecurityEvent } from '../../utils/auditLogger.js';
import { getVideoMetadata } from '../../utils/videoValidator.js';
import { transcodeToFormat } from '../../utils/media/videoNormalization.js';
import { VIDEO_FORMATS } from '../../utils/media/videoFormats.js';
import { computeContentHash } from '../../utils/media/contentHash.js';
import { logger } from '../../utils/logger.js';
import { localPathToPublicUploadsPath, resolveUploadFilePath, safeUnlink } from './submissionShared.js';

export type SubmissionUploadResult = {
  finalFilePath: string;
  fileHash: string | null;
  contentHash: string | null;
  normalizedMimeType: string;
  normalizedSizeBytes: number;
  effectiveDurationMs: number | null;
  tempFileForCleanup: string | null;
  fileHashForCleanup: string | null;
  fileHashRefAdded: boolean;
};

export async function processSubmissionUpload(opts: {
  req: AuthRequest;
  res: Response;
  channelId: string;
}): Promise<SubmissionUploadResult | null> {
  const { req, res, channelId } = opts;
  let tempFileForCleanup: string | null = null;
  let fileHashForCleanup: string | null = null;
  let fileHashRefAdded = false;

  if (!req.file?.mimetype.startsWith('video/')) {
    const filePath = resolveUploadFilePath(req.file?.path || '');
    if (filePath) {
      await safeUnlink(filePath);
    }
    res.status(400).json({
      errorCode: 'INVALID_FILE_TYPE',
      error: 'Invalid file type. Only video files are allowed.',
      details: { declaredMimeType: req.file?.mimetype },
    });
    return null;
  }

  const filePath = resolveUploadFilePath(req.file.path);
  tempFileForCleanup = filePath;
  const contentValidation = await validateFileContent(filePath, req.file.mimetype);
  if (!contentValidation.valid) {
    await safeUnlink(filePath);

    await logSecurityEvent(
      'file_validation_failed',
      req.userId!,
      channelId,
      {
        fileName: req.file.originalname,
        declaredType: req.file.mimetype,
        detectedType: contentValidation.detectedType,
        error: contentValidation.error,
      },
      req
    );

    res.status(400).json({
      errorCode: 'INVALID_FILE_CONTENT',
      error: 'Invalid file content',
      message: contentValidation.error || 'File content does not match declared file type',
    });
    return null;
  }

  const MAX_SIZE = 50 * 1024 * 1024; // 50MB
  if (req.file.size > MAX_SIZE) {
    await safeUnlink(filePath);
    res.status(413).json({
      errorCode: 'FILE_TOO_LARGE',
      error: 'File too large',
      details: { maxBytes: MAX_SIZE, sizeBytes: req.file.size },
    });
    return null;
  }

  const metadata = await getVideoMetadata(filePath);
  const bodyRaw = req.body as Record<string, unknown>;
  const clientDurationMsRaw = bodyRaw.durationMs ?? bodyRaw.duration_ms;
  const clientDurationMs =
    typeof clientDurationMsRaw === 'string'
      ? parseInt(clientDurationMsRaw, 10)
      : typeof clientDurationMsRaw === 'number'
        ? clientDurationMsRaw
        : null;

  const serverDurationSec = metadata?.duration && metadata.duration > 0 ? metadata.duration : null;
  const serverDurationMs = serverDurationSec !== null ? Math.round(serverDurationSec * 1000) : null;

  let effectiveDurationMs =
    serverDurationMs ?? (Number.isFinite(clientDurationMs as number) ? (clientDurationMs as number) : null);

  if (effectiveDurationMs === null) {
    logger.warn('submission.duration_unknown', {
      requestId: req.requestId,
      userId: req.userId,
      channelId,
      file: req.file?.originalname,
      mime: req.file?.mimetype,
    });
  } else if (effectiveDurationMs > 15000) {
    await safeUnlink(filePath);
    res.status(413).json({
      errorCode: 'VIDEO_TOO_LONG',
      error: 'Video is too long',
      details: { maxDurationMs: 15000, durationMs: effectiveDurationMs },
    });
    return null;
  }

  let normalizedPath = filePath;
  let normalizedMimeType = 'video/mp4';
  let normalizedDurationMs: number | null = null;
  let normalizedPublicPath: string | null = null;
  let normalizedFileHash: string | null = null;
  let contentHash: string | null = null;
  try {
    contentHash = await computeContentHash(filePath);
    const baseName = `upload-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const outputDir = fs.realpathSync(path.dirname(filePath));
    const normalized = await transcodeToFormat(filePath, outputDir, 'mp4', baseName);
    normalizedPath = normalized.outputPath;
    normalizedMimeType = VIDEO_FORMATS.mp4.mimeType;
    normalizedDurationMs = normalized.durationMs;
    normalizedFileHash = normalized.fileHash;
    normalizedPublicPath = localPathToPublicUploadsPath(normalizedPath);
    tempFileForCleanup = normalizedPath;

    if (normalizedPath !== filePath) {
      await safeUnlink(filePath);
    }
  } catch (error) {
    await safeUnlink(filePath);
    res.status(422).json({
      errorCode: 'TRANSCODE_FAILED',
      error: 'Failed to transcode video',
      message: error instanceof Error ? error.message : 'Video could not be normalized',
    });
    return null;
  }

  if (normalizedDurationMs !== null) {
    effectiveDurationMs = normalizedDurationMs;
    if (effectiveDurationMs > 15000) {
      await safeUnlink(normalizedPath);
      res.status(413).json({
        errorCode: 'VIDEO_TOO_LONG',
        error: 'Video is too long',
        details: { maxDurationMs: 15000, durationMs: effectiveDurationMs },
      });
      return null;
    }
  }

  const normalizedStats = await fs.promises.stat(normalizedPath);
  const normalizedSizeBytes = Number.isFinite(normalizedStats.size) ? normalizedStats.size : req.file.size;
  if (normalizedSizeBytes > MAX_SIZE) {
    await safeUnlink(normalizedPath);
    res.status(413).json({
      errorCode: 'FILE_TOO_LARGE',
      error: 'File too large',
      details: { maxBytes: MAX_SIZE, sizeBytes: normalizedSizeBytes },
    });
    return null;
  }

  let finalFilePath: string;
  let fileHash: string | null = null;
  tempFileForCleanup = normalizedPath;
  try {
    const hash =
      normalizedFileHash ??
      (await Promise.race([
        calculateFileHash(normalizedPath),
        new Promise<string>((_, reject) => {
          setTimeout(() => reject(new Error('Hash calculation timeout')), 30000);
        }),
      ]));
    const stats = await getFileStats(normalizedPath);
    const result = await findOrCreateFileHash(normalizedPath, hash, stats.mimeType, stats.size);
    finalFilePath = result.filePath;
    fileHash = hash;
    fileHashForCleanup = hash;
    fileHashRefAdded = true;
    tempFileForCleanup = null;
    logger.info('submission.file_deduplication', {
      requestId: req.requestId,
      userId: req.userId,
      channelId,
      isNew: result.isNew,
      fileHash: hash,
    });
  } catch (error) {
    logger.error('submission.filehash_failed', {
      requestId: req.requestId,
      userId: req.userId,
      channelId,
      errorMessage: (error as Error).message,
    });
    finalFilePath = normalizedPublicPath || `/uploads/${req.file.filename}`;
  }

  return {
    finalFilePath,
    fileHash,
    contentHash,
    normalizedMimeType,
    normalizedSizeBytes,
    effectiveDurationMs,
    tempFileForCleanup,
    fileHashForCleanup,
    fileHashRefAdded,
  };
}
