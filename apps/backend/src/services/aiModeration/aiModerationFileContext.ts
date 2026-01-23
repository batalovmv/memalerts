import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { calculateFileHash } from '../../utils/fileHash.js';
import { computeContentHash } from '../../utils/media/contentHash.js';
import { validatePathWithinDirectory } from '../../utils/pathSecurity.js';
import { clampInt, tryExtractSha256FromUploadsPath, withTimeout } from './aiModerationHelpers.js';
import type { AiModerationSubmission } from './aiModerationTypes.js';

export type AiModerationFileContext = {
  fileUrl: string;
  localPath: string | null;
  localFileExists: boolean;
  localRootUsed: string | null;
  fileHash: string;
  contentHash: string | null;
  durationMs: number | null;
};

export async function resolveAiModerationFileContext(
  submission: AiModerationSubmission,
  submissionId: string
): Promise<AiModerationFileContext> {
  const fileUrl = submission.fileUrlTemp ? String(submission.fileUrlTemp) : '';
  let localPath: string | null = null;
  let localFileExists = false;
  let localRootUsed: string | null = null;

  if (fileUrl.startsWith('/uploads/')) {
    const rel = fileUrl.replace(/^\/uploads\//, '');
    const roots = Array.from(
      new Set([
        path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads'),
        path.resolve(process.cwd(), './uploads'),
      ])
    );

    for (const r of roots) {
      const candidate = validatePathWithinDirectory(rel, r);
      if (fs.existsSync(candidate)) {
        localPath = candidate;
        localFileExists = true;
        localRootUsed = r;
        break;
      }
      if (!localPath) {
        localPath = candidate;
        localRootUsed = r;
      }
    }
  }

  let fileHash = submission.fileHash ? String(submission.fileHash) : null;
  if (!fileHash) {
    const recovered = tryExtractSha256FromUploadsPath(submission.fileUrlTemp);
    if (recovered) {
      fileHash = recovered;
      await prisma.memeSubmission.update({
        where: { id: submissionId },
        data: { fileHash: recovered },
      });
    }
  }

  if (!fileHash && localPath) {
    if (!localFileExists) {
      logger.warn('ai_moderation.file_missing', {
        submissionId,
        fileUrl,
        uploadDirEnv: process.env.UPLOAD_DIR || null,
        localRootUsed,
        reason: 'missing_file_on_disk_before_hash',
      });
      throw new Error('missing_file_on_disk');
    }
    const hashTimeoutMs = clampInt(
      parseInt(String(process.env.AI_FILEHASH_TIMEOUT_MS || ''), 10),
      5_000,
      10 * 60_000,
      2 * 60_000
    );
    const computed = await withTimeout(calculateFileHash(localPath), hashTimeoutMs, 'ai_filehash');
    fileHash = computed;
    await prisma.memeSubmission.update({
      where: { id: submissionId },
      data: { fileHash: computed },
    });
  }

  const durationMs =
    typeof submission.durationMs === 'number' && Number.isFinite(submission.durationMs) && submission.durationMs > 0
      ? submission.durationMs
      : null;

  if (!fileHash) throw new Error('missing_filehash');

  let contentHash: string | null = null;
  if (localPath && localFileExists) {
    try {
      contentHash = await computeContentHash(localPath);
    } catch (error) {
      const err = error as Error;
      logger.warn('ai_moderation.contenthash_failed', {
        submissionId,
        fileUrl,
        errorMessage: err?.message || String(error),
      });
    }
  }

  return {
    fileUrl,
    localPath,
    localFileExists,
    localRootUsed,
    fileHash,
    contentHash,
    durationMs,
  };
}
