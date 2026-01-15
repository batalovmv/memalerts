import fs from 'fs';
import path from 'path';
import { prisma } from '../src/lib/prisma.js';
import {
  calculateFileHash,
  decrementFileHashReference,
  findOrCreateFileHash,
  getFileStats,
} from '../src/utils/fileHash.js';
import { createFileHash } from './factories/index.js';

function rand(): string {
  return Math.random().toString(16).slice(2);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

describe('FileHash dedup concurrency', () => {
  it('concurrent upload dedup keeps single hash with correct referenceCount', async () => {
    const ext = '.mp4';
    const tempDir = path.join(process.cwd(), 'uploads', 'temp', `dedup_${rand()}`);
    await fs.promises.mkdir(tempDir, { recursive: true });

    const content = Buffer.from(`dedup-${rand()}`, 'utf8');
    const tempFiles: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const p = path.join(tempDir, `file_${i}${ext}`);
      await fs.promises.writeFile(p, content);
      tempFiles.push(p);
    }

    const hash = await calculateFileHash(tempFiles[0]);
    const stats = await getFileStats(tempFiles[0]);

    let cleanupCount = 0;
    try {
      await Promise.all(tempFiles.map((p) => findOrCreateFileHash(p, hash, stats.mimeType, stats.size)));
      cleanupCount = tempFiles.length;

      const count = await prisma.fileHash.count({ where: { hash } });
      expect(count).toBe(1);

      const fh = await prisma.fileHash.findUnique({ where: { hash } });
      expect(fh?.referenceCount).toBe(tempFiles.length);

      const storedPath = path.resolve(process.cwd(), 'uploads', 'memes', `${hash}${ext}`);
      expect(await fileExists(storedPath)).toBe(true);
    } finally {
      if (cleanupCount > 0) {
        await Promise.all(Array.from({ length: cleanupCount }, () => decrementFileHashReference(hash)));
      }
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('concurrent delete cleans up file and record exactly once', async () => {
    const ext = '.mp4';
    const hash = `del_${rand()}`;
    const refCount = 8;
    const publicPath = `/uploads/memes/${hash}${ext}`;
    const absPath = path.resolve(process.cwd(), 'uploads', 'memes', `${hash}${ext}`);

    await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
    await fs.promises.writeFile(absPath, 'test');

    await createFileHash({
      hash,
      filePath: publicPath,
      referenceCount: refCount,
      fileSize: BigInt(4),
      mimeType: 'video/mp4',
    });

    await Promise.all(Array.from({ length: refCount }, () => decrementFileHashReference(hash)));

    const fh = await prisma.fileHash.findUnique({ where: { hash } });
    expect(fh).toBeNull();
    expect(await fileExists(absPath)).toBe(false);
  });

  it('rolls back refCount when downstream failure occurs', async () => {
    const ext = '.mp4';
    const tempDir = path.join(process.cwd(), 'uploads', 'temp', `rollback_${rand()}`);
    await fs.promises.mkdir(tempDir, { recursive: true });
    const tempFile = path.join(tempDir, `file${ext}`);
    await fs.promises.writeFile(tempFile, `rollback-${rand()}`);

    const hash = await calculateFileHash(tempFile);
    const stats = await getFileStats(tempFile);

    let refAdded = false;
    try {
      await findOrCreateFileHash(tempFile, hash, stats.mimeType, stats.size);
      refAdded = true;
      throw new Error('boom');
    } catch {
      if (refAdded) {
        await decrementFileHashReference(hash);
        refAdded = false;
      }
    }

    const fh = await prisma.fileHash.findUnique({ where: { hash } });
    expect(fh).toBeNull();

    const storedPath = path.resolve(process.cwd(), 'uploads', 'memes', `${hash}${ext}`);
    expect(await fileExists(storedPath)).toBe(false);

    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });
});
