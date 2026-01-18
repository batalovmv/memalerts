import { createHash } from 'crypto';
import { getBullmqConnection, getBullmqPrefix } from './bullmqConnection.js';
import type { ChatOutboxPlatform } from './chatOutboxQueue.js';

type LocalEntry = { expiresAtMs: number };

const local = new Map<string, LocalEntry>();

function nowMs(): number {
  return Date.now();
}

function hashMessage(message: string): string {
  return createHash('sha1').update(message).digest('hex');
}

function buildKey(platform: ChatOutboxPlatform, channelId: string, message: string): string {
  const hash = hashMessage(message);
  return `${getBullmqPrefix()}:chat-outbox-dedup:${platform}:${channelId}:${hash}`;
}

export async function isDuplicateChatOutboxMessage(params: {
  platform: ChatOutboxPlatform;
  channelId: string;
  message: string;
  dedupWindowMs: number;
}): Promise<boolean> {
  const windowMs = Math.max(1000, Math.floor(params.dedupWindowMs));
  const key = buildKey(params.platform, params.channelId, params.message);

  const client = getBullmqConnection();
  if (!client) {
    const now = nowMs();
    const entry = local.get(key);
    if (entry && now < entry.expiresAtMs) return true;
    local.set(key, { expiresAtMs: now + windowMs });
    return false;
  }

  try {
    const res = await client.set(key, '1', 'PX', windowMs, 'NX');
    return res !== 'OK';
  } catch {
    const now = nowMs();
    const entry = local.get(key);
    if (entry && now < entry.expiresAtMs) return true;
    local.set(key, { expiresAtMs: now + windowMs });
    return false;
  }
}
