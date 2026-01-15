import type { AuthRequest } from '../../middleware/auth.js';
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
