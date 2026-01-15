import type { AuthRequest } from '../../middleware/auth.js';
import path from 'path';
import fs from 'fs';

export function parseChannelId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return null;
}

export function getChannelIdFromRequest(req: AuthRequest): string | null {
  const bodyChannel = (req.body as Record<string, unknown>)?.channelId;
  const queryChannel = (req.query as Record<string, unknown>)?.channelId;
  return parseChannelId(bodyChannel) ?? parseChannelId(queryChannel) ?? parseChannelId(req.channelId);
}

export async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // ignore
  }
}

export function localPathToPublicUploadsPath(localPath: string): string | null {
  const uploadsRoot = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads');
  const rel = path.relative(uploadsRoot, localPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return `/uploads/${rel.replace(/\\/g, '/')}`;
}

export function resolveUploadFilePath(rawPath: string): string {
  if (path.isAbsolute(rawPath) || path.win32.isAbsolute(rawPath)) {
    return rawPath;
  }
  return path.join(process.cwd(), rawPath);
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
