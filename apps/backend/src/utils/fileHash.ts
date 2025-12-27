import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma.js';
import https from 'https';
import http from 'http';
import { Semaphore, parsePositiveIntEnv } from './semaphore.js';
import { getStorageProvider } from '../storage/index.js';
import { validatePathWithinDirectory } from './pathSecurity.js';
import { logger } from './logger.js';

const hashConcurrency = parsePositiveIntEnv(
  'FILE_HASH_CONCURRENCY',
  process.env.NODE_ENV === 'production' ? 2 : 4
);
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
  } catch (e: any) {
    // Cross-device move fallback (rare on VPS, but possible with temp dirs).
    if (e?.code === 'EXDEV') {
      await fs.promises.copyFile(src, dst);
      await safeUnlink(src);
      return;
    }
    throw e;
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
  // Check if file with this hash already exists
  const existing = await prisma.fileHash.findUnique({
    where: { hash },
  });

  if (existing) {
    // File exists - increment reference count and use existing path
    await prisma.fileHash.update({
      where: { hash },
      data: {
        referenceCount: {
          increment: 1,
        },
      },
    });

    const existingPath = String(existing.filePath || '');
    const storage = getStorageProvider();

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
          } catch (e: any) {
            logger.error('filehash.dedup.repair_failed', {
              hash,
              existingFilePath: existingPath,
              attemptedAbsPath: abs,
              errorMessage: e?.message || String(e),
            });
            // Fall back to legacy behavior below.
          }
        }
      }
    }

    // Delete temp file since we're using existing one (default behavior).
    try {
      await safeUnlink(tempFilePath);
      logger.debug('filehash.dedup.temp_deleted', { hash, tempFilePath, existingFilePath: existingPath });
    } catch (error: any) {
      logger.warn('filehash.dedup.temp_delete_failed', {
        hash,
        tempFilePath,
        existingFilePath: existingPath,
        errorMessage: error?.message || String(error),
      });
    }

    return { filePath: existingPath, isNew: false };
  }

  // File doesn't exist - move temp file to permanent location
  const extWithDot = path.extname(tempFilePath) || '';
  const storage = getStorageProvider();
  const stored = await storage.storeMemeFromTemp({
    tempFilePath,
    hash,
    extWithDot,
    mimeType,
  });

  // Create FileHash record
  await prisma.fileHash.create({
    data: {
      hash,
      filePath: stored.publicPath,
      referenceCount: 1,
      fileSize,
      mimeType,
    },
  });

  return { filePath: stored.publicPath, isNew: true };
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
export async function decrementFileHashReference(hash: string): Promise<void> {
  const fileHash = await prisma.fileHash.findUnique({
    where: { hash },
  });

  if (!fileHash) {
    console.warn(`FileHash not found for hash: ${hash}`);
    return;
  }

  if (fileHash.referenceCount <= 1) {
    // Last reference - delete file and record
    try {
      const storage = getStorageProvider();
      await storage.deleteByPublicPath(String(fileHash.filePath || ''));
    } catch (e: any) {
      console.error(`Failed to delete storage object for hash=${hash}:`, e?.message || e);
    }

    await prisma.fileHash.delete({
      where: { hash },
    });
  } else {
    // Decrement reference count
    await prisma.fileHash.update({
      where: { hash },
      data: {
        referenceCount: {
          decrement: 1,
        },
      },
    });
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
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
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
      
      // Check if file with this hash already exists
      const existing = await prisma.fileHash.findUnique({
        where: { hash },
      });

      if (existing) {
        // File exists - increment reference count and delete temp file
        await prisma.fileHash.update({
          where: { hash },
          data: {
            referenceCount: {
              increment: 1,
            },
          },
        });

        // Delete temp file since we're using existing one
        try {
          await safeUnlink(tempFilePath);
        } catch (error) {
          console.warn('Failed to delete temp downloaded file:', error);
        }

        return { filePath: existing.filePath, fileHash: hash, isNew: false };
      }

      // File doesn't exist - store it via the configured storage provider (local or S3-compatible).
      const extWithDot = path.extname(tempFilePath) || '';
      const stats = await getFileStats(tempFilePath);
      const storage = getStorageProvider();
      const stored = await storage.storeMemeFromTemp({
        tempFilePath,
        hash,
        extWithDot,
        mimeType: stats.mimeType,
      });

      // Create FileHash record
      await prisma.fileHash.create({
        data: {
          hash,
          filePath: stored.publicPath,
          referenceCount: 1,
          fileSize: stats.size,
          mimeType: stats.mimeType,
        },
      });

      return { filePath: stored.publicPath, fileHash: hash, isNew: true };
    } catch (error: any) {
      // Clean up temp file on error
      try {
        await safeUnlink(tempFilePath);
      } catch (cleanupError) {
        console.warn('Failed to cleanup temp file:', cleanupError);
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

