import fs from 'fs';
import path from 'path';
import { validatePathWithinDirectory } from '../utils/pathSecurity.js';
import type { StorageProvider, StoreFromTempArgs, StoredObject } from './types.js';

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

export class LocalStorageProvider implements StorageProvider {
  kind: 'local' = 'local';

  async storeMemeFromTemp(args: StoreFromTempArgs): Promise<StoredObject> {
    const permanentDir = path.join(getUploadsRootDir(), 'memes');
    const publicPath = `/uploads/memes/${args.hash}${args.extWithDot}`;
    const permanentPath = path.join(permanentDir, `${args.hash}${args.extWithDot}`);

    await fs.promises.mkdir(permanentDir, { recursive: true });
    await fs.promises.rename(args.tempFilePath, permanentPath).catch((err) => {
      if ((err as any)?.code === 'ENOENT') throw new Error('Temp file not found');
      throw err;
    });

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


