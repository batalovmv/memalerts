import fs from 'fs';
import path from 'path';
import { downloadFileFromUrl } from '../fileHash.js';
import { validatePathWithinDirectory } from '../pathSecurity.js';
import { logger } from '../logger.js';

export type ResolvedMediaPath = {
  localPath: string;
  cleanup: () => Promise<void>;
};

function safeUnlink(filePath: string): Promise<void> {
  return fs.promises
    .unlink(filePath)
    .catch(() => undefined)
    .then(() => undefined);
}

function resolveUploadsRoots(): string[] {
  const uploadDir = process.env.UPLOAD_DIR || './uploads';
  const roots = [path.resolve(process.cwd(), uploadDir), path.resolve(process.cwd(), './uploads')];
  return Array.from(new Set(roots));
}

export async function resolveLocalMediaPath(fileUrl: string): Promise<ResolvedMediaPath | null> {
  const trimmed = String(fileUrl || '').trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('/uploads/')) {
    const rel = trimmed.replace(/^\/uploads\//, '');
    const roots = resolveUploadsRoots();
    for (const root of roots) {
      try {
        const candidate = validatePathWithinDirectory(rel, root);
        if (fs.existsSync(candidate)) {
          return { localPath: candidate, cleanup: async () => undefined };
        }
      } catch {
        // ignore invalid roots
      }
    }
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const tempPath = await downloadFileFromUrl(trimmed);
      return { localPath: tempPath, cleanup: async () => safeUnlink(tempPath) };
    } catch (error) {
      const err = error as Error;
      logger.warn('media.resolve_local_failed', { fileUrl: trimmed, errorMessage: err?.message || String(error) });
      return null;
    }
  }

  return null;
}
