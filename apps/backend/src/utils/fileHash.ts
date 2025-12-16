import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma.js';
import https from 'https';
import http from 'http';

/**
 * Calculate SHA-256 hash of a file
 */
export async function calculateFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
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

    // Delete temp file since we're using existing one
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (error) {
      console.warn('Failed to delete temp file:', error);
    }

    return { filePath: existing.filePath, isNew: false };
  }

  // File doesn't exist - move temp file to permanent location
  const ext = path.extname(tempFilePath);
  const permanentDir = path.join(process.cwd(), 'uploads', 'memes');
  const permanentPath = path.join(permanentDir, `${hash}${ext}`);

  // Ensure directory exists
  if (!fs.existsSync(permanentDir)) {
    fs.mkdirSync(permanentDir, { recursive: true });
  }

  // Move file
  if (fs.existsSync(tempFilePath)) {
    fs.renameSync(tempFilePath, permanentPath);
  } else {
    throw new Error('Temp file not found');
  }

  // Create FileHash record
  await prisma.fileHash.create({
    data: {
      hash,
      filePath: `/uploads/memes/${hash}${ext}`,
      referenceCount: 1,
      fileSize,
      mimeType,
    },
  });

  return { filePath: `/uploads/memes/${hash}${ext}`, isNew: true };
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
    const filePath = path.join(process.cwd(), fileHash.filePath);
    
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error(`Failed to delete file ${filePath}:`, error);
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
    
    // Set timeout (30 seconds)
    const timeout = 30000;
    let timeoutId: NodeJS.Timeout;

    const request = client.get(url, (response) => {
      // Check for redirect
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
        const redirectUrl = response.headers.location;
        if (!redirectUrl) {
          file.close();
          fs.unlinkSync(tempFilePath);
          reject(new Error('Redirect location not found'));
          return;
        }
        // Follow redirect
        return downloadFileFromUrl(redirectUrl, tempDir).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(tempFilePath);
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
        fs.unlinkSync(tempFilePath);
        reject(err);
      });
    });

    request.on('error', (err) => {
      clearTimeout(timeoutId);
      file.close();
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      reject(err);
    });

    // Set timeout
    timeoutId = setTimeout(() => {
      request.destroy();
      file.close();
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
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
  // Wrap entire operation in timeout (60 seconds total)
  const operationTimeout = 60000;
  
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
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
        } catch (error) {
          console.warn('Failed to delete temp downloaded file:', error);
        }

        return { filePath: existing.filePath, fileHash: hash, isNew: false };
      }

      // File doesn't exist - move temp file to permanent location
      const ext = path.extname(tempFilePath);
      const permanentDir = path.join(process.cwd(), 'uploads', 'memes');
      const permanentPath = path.join(permanentDir, `${hash}${ext}`);

      // Ensure directory exists
      if (!fs.existsSync(permanentDir)) {
        fs.mkdirSync(permanentDir, { recursive: true });
      }

      // Move file
      if (fs.existsSync(tempFilePath)) {
        fs.renameSync(tempFilePath, permanentPath);
      } else {
        throw new Error('Temp downloaded file not found');
      }

      // Get file stats
      const stats = await getFileStats(permanentPath);

      // Create FileHash record
      await prisma.fileHash.create({
        data: {
          hash,
          filePath: `/uploads/memes/${hash}${ext}`,
          referenceCount: 1,
          fileSize: stats.size,
          mimeType: stats.mimeType,
        },
      });

      return { filePath: `/uploads/memes/${hash}${ext}`, fileHash: hash, isNew: true };
    } catch (error: any) {
      // Clean up temp file on error
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
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

