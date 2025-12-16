import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma.js';

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

