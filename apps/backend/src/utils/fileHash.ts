import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import https from 'https';
import http from 'http';
import { Semaphore, parsePositiveIntEnv } from './semaphore.js';
import { getStorageProvider } from '../storage/index.js';
import { validatePathWithinDirectory } from './pathSecurity.js';
import { logger } from './logger.js';
import { recordFileHashOrphanFile } from './metrics.js';

const hashConcurrency = parsePositiveIntEnv('FILE_HASH_CONCURRENCY', process.env.NODE_ENV === 'production' ? 2 : 4);
const hashSemaphore = new Semaphore(hashConcurrency);

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // ignore
  }
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.promises.access(absPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function safeMoveFile(src: string, dst: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(dst), { recursive: true });
  try {
    await fs.promises.rename(src, dst);
  } catch (error) {
    const err = error as { code?: string };
    // Cross-device move fallback (rare on VPS, but possible with temp dirs).
    if (err.code === 'EXDEV') {
      await fs.promises.copyFile(src, dst);
      await safeUnlink(src);
      return;
    }
    throw error;
  }
}

function getUploadsRootAbs(): string {
  const uploadDir = process.env.UPLOAD_DIR || './uploads';
  return path.resolve(process.cwd(), uploadDir);
}

function publicUploadsPathToAbs(publicPath: string): string | null {
  const p = String(publicPath || '').trim();
  if (!p.startsWith('/uploads/')) return null;
  const uploadsRoot = getUploadsRootAbs();
  const rel = p.replace(/^\/uploads\//, '');
  try {
    return validatePathWithinDirectory(rel, uploadsRoot);
  } catch {
    return null;
  }
}

/**
 * Calculate SHA-256 hash of a file
 */
export async function calculateFileHash(filePath: string): Promise<string> {
  return hashSemaphore.use(
    () =>
      new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);

        stream.on('data', (data) => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
      })
  );
}

/**
 * Get file stats (size and mime type)
 */
export async function getFileStats(filePath: string): Promise<{ size: bigint; mimeType: string }> {
  const stats = await fs.promises.stat(filePath);
  const ext = path.extname(filePath).toLowerCase();

  // Simple MIME type detection based on extension
  const mimeTypes: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
  };

  return {
    size: BigInt(stats.size),
    mimeType: mimeTypes[ext] || 'application/octet-stream',
  };
}

/**
 * Find existing file hash or create new one
 * Returns the file path to use (either existing or new)
 */
export async function findOrCreateFileHash(
  tempFilePath: string,
  hash: string,
  mimeType: string,
  fileSize: bigint
): Promise<{ filePath: string; isNew: boolean }> {
  const extWithDot = path.extname(tempFilePath) || '';
  const storage = getStorageProvider();
  const plannedPublicPath = storage.getPublicPathForHash({ hash, extWithDot });

  const upserted = await prisma.fileHash.upsert({
    where: { hash },
    create: {
      hash,
      filePath: plannedPublicPath,
      referenceCount: 1,
      fileSize,
      mimeType,
    },
    update: {
      referenceCount: {
        increment: 1,
      },
    },
  });

  const isNew = upserted.referenceCount === 1;
  if (isNew) {
    try {
      await storage.storeMemeFromTemp({
        tempFilePath,
        hash,
        extWithDot,
        mimeType,
      });
    } catch (e) {
      try {
        await decrementFileHashReference(hash);
      } catch {
        // ignore
      }
      throw e;
    }
    return { filePath: upserted.filePath, isNew: true };
  }

  const existingPath = String(upserted.filePath || '');

  // IMPORTANT (multi-instance + shared DB):
  // In shared DB mode (beta+prod), local storage is NOT shared across instances (different cwd/UPLOAD_DIR).
  // If we blindly delete temp upload on a dedup hit, we can end up with a DB filePath that points to a
  // file that doesn't exist on this instance => /uploads 404. Mitigation: if local storage and the
  // expected file is missing locally, "repair" by moving this temp upload into the expected location.
  if (storage.kind === 'local') {
    const abs = publicUploadsPathToAbs(existingPath);
    if (abs) {
      const exists = await fileExists(abs);
      if (!exists) {
        try {
          await safeMoveFile(tempFilePath, abs);
          logger.warn('filehash.dedup.repair_missing_local', {
            hash,
            existingFilePath: existingPath,
            repairedAbsPath: abs,
          });
          return { filePath: existingPath, isNew: false };
        } catch (error) {
          const err = error as { code?: string; message?: string };
          if (err.code === 'EEXIST' || err.code === 'EPERM' || err.code === 'EACCES') {
            const existsNow = await fileExists(abs);
            if (existsNow) {
              await safeUnlink(tempFilePath);
              return { filePath: existingPath, isNew: false };
            }
          }
          logger.error('filehash.dedup.repair_failed', {
            hash,
            existingFilePath: existingPath,
            attemptedAbsPath: abs,
            errorMessage: err.message || String(error),
          });
          try {
            await decrementFileHashReference(hash);
          } catch {
            // ignore
          }
          // Do NOT silently fall back: it would return an existingPath that still 404s on this instance.
          // Keep the temp file for debugging / manual recovery.
          throw new Error(`Local dedup repair failed for hash=${hash}; expectedPath=${existingPath}`);
        }
      }
    }
  }

  // Delete temp file since we're using existing one (default behavior).
  try {
    await safeUnlink(tempFilePath);
    logger.debug('filehash.dedup.temp_deleted', { hash, tempFilePath, existingFilePath: existingPath });
  } catch (error) {
    const err = error as { message?: string };
    logger.warn('filehash.dedup.temp_delete_failed', {
      hash,
      tempFilePath,
      existingFilePath: existingPath,
      errorMessage: err.message || String(error),
    });
  }

  return { filePath: existingPath, isNew: false };
}

/**
 * Increment reference count for a file hash
 */
export async function incrementFileHashReference(hash: string): Promise<void> {
  await prisma.fileHash.update({
    where: { hash },
    data: {
      referenceCount: {
        increment: 1,
      },
    },
  });
}

/**
 * Decrement reference count and delete file if count reaches 0
 */
export async function decrementFileHashReferenceInTx(
  tx: Prisma.TransactionClient,
  hash: string
): Promise<string | null> {
  let deletePublicPath: string | null = null;

  const deleted = await tx.$queryRaw<{ filePath: string }[]>`
    DELETE FROM "FileHash"
    WHERE "hash" = ${hash} AND "referenceCount" = 1
    RETURNING "filePath"
  `;

  if (deleted.length > 0) {
    deletePublicPath = String(deleted[0].filePath || '');
    return deletePublicPath;
  }

  const updated = await tx.fileHash.updateMany({
    where: { hash, referenceCount: { gt: 1 } },
    data: {
      referenceCount: {
        decrement: 1,
      },
    },
  });

  if (updated.count === 0) {
    const deletedAfter = await tx.$queryRaw<{ filePath: string }[]>`
      DELETE FROM "FileHash"
      WHERE "hash" = ${hash} AND "referenceCount" = 1
      RETURNING "filePath"
    `;
    if (deletedAfter.length > 0) {
      deletePublicPath = String(deletedAfter[0].filePath || '');
    }
  }

  return deletePublicPath;
}

export async function deleteFileHashStorage(hash: string, publicPath: string | null): Promise<void> {
  if (!publicPath) return;
  const storage = getStorageProvider();
  try {
    await storage.deleteByPublicPath(publicPath);
  } catch (error) {
    const err = error as { message?: string };
    logger.error('filehash.storage_delete_failed', {
      hash,
      errorMessage: err.message || String(error),
    });
    recordFileHashOrphanFile(storage.kind);
  }
}

export async function decrementFileHashReference(hash: string): Promise<void> {
  let deletePublicPath: string | null = null;

  await prisma.$transaction(async (tx) => {
    deletePublicPath = await decrementFileHashReferenceInTx(tx, hash);
  });

  if (deletePublicPath) {
    await deleteFileHashStorage(hash, deletePublicPath);
  }
}

/**
 * Get file hash by file path (for existing files)
 */
export async function getFileHashByPath(filePath: string): Promise<string | null> {
  const fileHash = await prisma.fileHash.findFirst({
    where: {
      filePath: {
        equals: filePath,
      },
    },
  });

  return fileHash?.hash || null;
}

/**
 * Download file from URL and save to temporary location
 * Returns the path to the downloaded file
 */
export async function downloadFileFromUrl(url: string, tempDir?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const downloadDir = tempDir || path.join(process.cwd(), 'uploads', 'temp');

    // Ensure directory exists
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }

    // Generate temporary filename
    const urlObj = new URL(url);
    const ext = path.extname(urlObj.pathname) || '.webm'; // Default to .webm for memalerts URLs
    const tempFileName = `download-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    const tempFilePath = path.join(downloadDir, tempFileName);

    // Choose http or https module
    const client = url.startsWith('https://') ? https : http;

    const file = fs.createWriteStream(tempFilePath);

    // Set timeout (20 seconds for faster response)
    const timeout = 20000;
    let timeoutId: NodeJS.Timeout;

    const request = client.get(url, (response) => {
      // Check for redirect
      if (
        response.statusCode === 301 ||
        response.statusCode === 302 ||
        response.statusCode === 307 ||
        response.statusCode === 308
      ) {
        const redirectUrl = response.headers.location;
        if (!redirectUrl) {
          file.close();
          void safeUnlink(tempFilePath);
          reject(new Error('Redirect location not found'));
          return;
        }
        // Follow redirect
        return downloadFileFromUrl(redirectUrl, tempDir).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        file.close();
        void safeUnlink(tempFilePath);
        reject(new Error(`Failed to download file: ${response.statusCode} ${response.statusMessage}`));
        return;
      }

      // Clear timeout on successful response
      clearTimeout(timeoutId);

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve(tempFilePath);
      });

      file.on('error', (err) => {
        file.close();
        void safeUnlink(tempFilePath);
        reject(err);
      });
    });

    request.on('error', (err) => {
      clearTimeout(timeoutId);
      file.close();
      void safeUnlink(tempFilePath);
      reject(err);
    });

    // Set timeout
    timeoutId = setTimeout(() => {
      request.destroy();
      file.close();
      void safeUnlink(tempFilePath);
      reject(new Error('Download timeout'));
    }, timeout);

    request.setTimeout(timeout);
  });
}

/**
 * Download file from URL, calculate hash, and perform deduplication
 * Returns the file path to use (either existing or newly downloaded)
 * Includes timeout protection to prevent hanging
 */
export async function downloadAndDeduplicateFile(
  url: string
): Promise<{ filePath: string; fileHash: string | null; isNew: boolean }> {
  // Wrap entire operation in timeout (40 seconds total for background operations)
  const operationTimeout = 40000;

  const operationPromise = (async () => {
    // Download file
    const tempFilePath = await downloadFileFromUrl(url);

    try {
      // Calculate hash of downloaded file (with timeout)
      const hashPromise = calculateFileHash(tempFilePath);
      const hashTimeout = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error('Hash calculation timeout')), 30000); // 30 second timeout for hashing
      });

      const hash = await Promise.race([hashPromise, hashTimeout]);

      const stats = await getFileStats(tempFilePath);
      const result = await findOrCreateFileHash(tempFilePath, hash, stats.mimeType, stats.size);
      return { filePath: result.filePath, fileHash: hash, isNew: result.isNew };
    } catch (error) {
      // Clean up temp file on error
      try {
        await safeUnlink(tempFilePath);
      } catch (cleanupError) {
        const err = cleanupError as Error;
        logger.warn('filehash.temp_cleanup_failed', { errorMessage: err.message });
      }
      throw error;
    }
  })();

  // Race with timeout
  const timeoutPromise = new Promise<{ filePath: string; fileHash: string | null; isNew: boolean }>((_, reject) => {
    setTimeout(() => reject(new Error('Download and deduplication timeout')), operationTimeout);
  });

  return Promise.race([operationPromise, timeoutPromise]);
}
