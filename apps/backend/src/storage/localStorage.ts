import fs from 'fs';
import path from 'path';
import { validatePathWithinDirectory } from '../utils/pathSecurity.js';
import type { StorageProvider, StoreFromTempArgs, StoredObject, PublicPathArgs } from './types.js';

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // ignore
  }
}

function getUploadsRootDir(): string {
  // Must match `src/index.ts` static mount of `/uploads`.
  // NOTE: UPLOAD_DIR can be relative (to cwd) or absolute.
  const uploadDir = process.env.UPLOAD_DIR || './uploads';
  return path.resolve(process.cwd(), uploadDir);
}

async function safeMoveFile(src: string, dst: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(dst), { recursive: true });
  try {
    await fs.promises.rename(src, dst);
  } catch (error) {
    const err = error as { code?: string };
    // Cross-device move fallback (e.g. temp dir on different mount).
    if (err.code === 'EXDEV') {
      await fs.promises.copyFile(src, dst);
      await safeUnlink(src);
      return;
    }
    throw error;
  }
}

export class LocalStorageProvider implements StorageProvider {
  kind: 'local' = 'local';

  getPublicPathForHash(args: PublicPathArgs): string {
    return `/uploads/memes/${args.hash}${args.extWithDot}`;
  }

  async storeMemeFromTemp(args: StoreFromTempArgs): Promise<StoredObject> {
    const permanentDir = path.join(getUploadsRootDir(), 'memes');
    const publicPath = this.getPublicPathForHash({ hash: args.hash, extWithDot: args.extWithDot });
    const permanentPath = path.join(permanentDir, `${args.hash}${args.extWithDot}`);

    const exists = await fs.promises
      .access(permanentPath, fs.constants.F_OK)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      await safeUnlink(args.tempFilePath);
      return { publicPath };
    }

    try {
      await safeMoveFile(args.tempFilePath, permanentPath);
    } catch (error) {
      const err = error as { code?: string };
      if (err.code === 'EEXIST') {
        await safeUnlink(args.tempFilePath);
        return { publicPath };
      }
      if (err.code === 'ENOENT') throw new Error('Temp file not found');
      throw error;
    }

    return { publicPath };
  }

  async deleteByPublicPath(publicPath: string): Promise<void> {
    // Only allow deletes within local uploads directory; reject anything else.
    // DB stores public paths like "/uploads/memes/<hash>.ext".
    const uploadsDir = getUploadsRootDir();
    const p = String(publicPath || '').trim();
    if (!p.startsWith('/uploads/')) return;

    // Convert public path -> relative fs path under uploadsDir.
    const rel = p.replace(/^\/uploads\//, '');
    let localPath: string;
    try {
      localPath = validatePathWithinDirectory(rel, uploadsDir);
    } catch {
      return;
    }
    await safeUnlink(localPath);
  }
}
