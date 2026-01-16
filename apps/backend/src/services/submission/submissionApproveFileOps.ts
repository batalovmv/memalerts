import type { AuthRequest } from '../../middleware/auth.js';
import path from 'path';
import fs from 'fs';
import {
  calculateFileHash,
  decrementFileHashReference,
  findOrCreateFileHash,
  getFileHashByPath,
  getFileStats,
  incrementFileHashReference,
} from '../../utils/fileHash.js';
import { validatePathWithinDirectory } from '../../utils/pathSecurity.js';
import { getVideoMetadata } from '../../utils/videoValidator.js';
import { logger } from '../../utils/logger.js';
import { debugLog } from '../../utils/debug.js';
import { asRecord, getErrorMessage } from './submissionShared.js';

export type ApprovalSubmission = {
  id: string;
  channelId: string;
  status: string;
  sourceKind: string | null;
  memeAssetId: string | null;
  title: string;
  submitterUserId: string | null;
  sourceUrl: string | null;
  fileUrlTemp: string;
  aiAutoTagNamesJson?: unknown;
  tags?: unknown[];
};

export async function resolveApprovalInputs(opts: {
  submission: ApprovalSubmission;
  body: { tags?: string[]; durationMs?: number; priceCoins?: number };
  txRepos: { memes: { asset: { findFirst: Function } } } & Record<string, unknown>;
  channelId: string;
  defaultPrice: number;
  req: AuthRequest;
  id: string;
  fileHashForCleanup: string | null;
  fileHashRefAdded: boolean;
}): Promise<{
  finalFileUrl: string;
  fileHash: string | null;
  durationMs: number;
  priceCoins: number;
  tagNames: string[];
  fileHashForCleanup: string | null;
  fileHashRefAdded: boolean;
}> {
  const { submission, body, txRepos, defaultPrice, id } = opts;
  let { fileHashForCleanup, fileHashRefAdded } = opts;

  let finalFileUrl: string;
  let fileHash: string | null = null;
  let filePath: string | null = null;
  const fileUrlTemp = String(submission.fileUrlTemp || '').trim();
  const isRemoteUrl = /^https?:\/\//i.test(fileUrlTemp);

  debugLog('[DEBUG] Processing file URL', {
    submissionId: id,
    hasSourceUrl: !!submission.sourceUrl,
    fileUrlTemp,
    isRemoteUrl,
  });

  if (!fileUrlTemp && !submission.sourceUrl) {
    throw new Error('Uploaded file not found');
  }

  if (submission.sourceUrl) {
    finalFileUrl = submission.sourceUrl;
  } else if (isRemoteUrl) {
    const existingHash = await getFileHashByPath(fileUrlTemp);

    if (existingHash) {
      finalFileUrl = fileUrlTemp;
      fileHash = existingHash;
      const blocked = await txRepos.memes.asset.findFirst({
        where: {
          fileHash: existingHash,
          OR: [{ purgeRequestedAt: { not: null } }, { purgedAt: { not: null } }],
        },
        select: { id: true },
      });
      if (blocked) {
        throw new Error('MEME_ASSET_DELETED');
      }
      await incrementFileHashReference(existingHash);
      fileHashForCleanup = existingHash;
      fileHashRefAdded = true;
    } else {
      finalFileUrl = fileUrlTemp;
      fileHash = null;
    }
  } else {
    try {
      const uploadsDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads');
      const relativePath = fileUrlTemp.startsWith('/') ? fileUrlTemp.slice(1) : fileUrlTemp;

      debugLog('[DEBUG] Validating file path', {
        submissionId: id,
        fileUrlTemp,
        relativePath,
        uploadsDir,
      });

      filePath = validatePathWithinDirectory(relativePath, uploadsDir);

      debugLog('[DEBUG] Path validated', { submissionId: id, filePath, fileExists: fs.existsSync(filePath) });
    } catch (pathError: unknown) {
      debugLog('[DEBUG] Path validation failed', {
        submissionId: id,
        fileUrlTemp,
        error: getErrorMessage(pathError),
      });
      logger.error('admin.submissions.path_validation_failed', {
        submissionId: id,
        fileUrlTemp,
        errorMessage: getErrorMessage(pathError),
      });
      throw new Error('Invalid file path: File path contains invalid characters or path traversal attempt');
    }

    const existingHash = await getFileHashByPath(fileUrlTemp);

    if (existingHash) {
      finalFileUrl = fileUrlTemp;
      fileHash = existingHash;
      const blocked = await txRepos.memes.asset.findFirst({
        where: {
          fileHash: existingHash,
          OR: [{ purgeRequestedAt: { not: null } }, { purgedAt: { not: null } }],
        },
        select: { id: true },
      });
      if (blocked) {
        throw new Error('MEME_ASSET_DELETED');
      }
      await incrementFileHashReference(existingHash);
      fileHashForCleanup = existingHash;
      fileHashRefAdded = true;
    } else if (filePath && fs.existsSync(filePath)) {
      try {
        const hashPromise = calculateFileHash(filePath);
        const hashTimeout = new Promise<string>((_, reject) => {
          setTimeout(() => reject(new Error('Hash calculation timeout')), 10000);
        });

        const hash = await Promise.race([hashPromise, hashTimeout]);
        const stats = await getFileStats(filePath);
        const result = await findOrCreateFileHash(filePath, hash, stats.mimeType, stats.size);
        finalFileUrl = result.filePath;
        fileHash = hash;
        fileHashForCleanup = hash;
        fileHashRefAdded = true;
        debugLog(`File deduplication on approve: ${result.isNew ? 'new file' : 'duplicate found'}, hash: ${hash}`);
      } catch (error: unknown) {
        logger.error('admin.submissions.filehash_failed', { errorMessage: getErrorMessage(error) });
        finalFileUrl = fileUrlTemp;
        fileHash = null;
      }
    } else {
      throw new Error('Uploaded file not found');
    }
  }

  if (fileHash) {
    const blocked = await txRepos.memes.asset.findFirst({
      where: { fileHash, OR: [{ purgeRequestedAt: { not: null } }, { purgedAt: { not: null } }] },
      select: { id: true },
    });
    if (blocked) {
      try {
        await decrementFileHashReference(fileHash);
        fileHashRefAdded = false;
      } catch {
        // ignore
      }
      throw new Error('MEME_ASSET_DELETED');
    }
  }

  const tagNames =
    body.tags && body.tags.length > 0
      ? body.tags
      : (() => {
          const submissionWithTags = submission as ApprovalSubmission & { tags?: unknown[] };
          const submissionTags = Array.isArray(submissionWithTags?.tags) ? (submissionWithTags.tags as unknown[]) : [];
          if (submissionTags.length > 0) {
            return submissionTags
              .map((st: unknown) => {
                const tagRec = asRecord(st);
                const tag = tagRec.tag;
                if (typeof tag === 'string') return tag;
                const tagName = asRecord(tag).name;
                return typeof tagName === 'string' ? tagName : null;
              })
              .filter((name: string | null): name is string => typeof name === 'string' && name.length > 0);
          }
          const aiTags = submission?.aiAutoTagNamesJson;
          return Array.isArray(aiTags) ? aiTags.filter((t): t is string => typeof t === 'string' && t.length > 0) : [];
        })();

  const STANDARD_DURATION_MS = 15000;
  let durationMs = body.durationMs || STANDARD_DURATION_MS;

  if (!submission.sourceUrl && filePath && fs.existsSync(filePath)) {
    try {
      const metadata = await getVideoMetadata(filePath);
      if (metadata && metadata.duration > 0) {
        durationMs = Math.round(metadata.duration * 1000);
      }
    } catch (error: unknown) {
      logger.warn('admin.submissions.video_duration_failed', { errorMessage: getErrorMessage(error) });
      durationMs = body.durationMs || STANDARD_DURATION_MS;
    }
  }

  const priceCoins = body.priceCoins || defaultPrice;

  return { finalFileUrl, fileHash, durationMs, priceCoins, tagNames, fileHashForCleanup, fileHashRefAdded };
}
