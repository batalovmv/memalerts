import { getBullmqConnection, getBullmqPrefix } from './bullmqConnection.js';
import type { ChatOutboxPlatform } from './chatOutboxQueue.js';

const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

export function buildChatOutboxLockKey(platform: ChatOutboxPlatform, channelId: string): string {
  return `${getBullmqPrefix()}:chat-outbox-lock:${platform}:${channelId}`;
}

export async function acquireChatOutboxChannelLock(opts: {
  platform: ChatOutboxPlatform;
  channelId: string;
  ownerId: string;
  ttlMs: number;
}): Promise<{ acquired: boolean; key: string | null }> {
  const redis = getBullmqConnection();
  if (!redis) return { acquired: false, key: null };
  const key = buildChatOutboxLockKey(opts.platform, opts.channelId);
  const res = await redis.set(key, opts.ownerId, 'PX', Math.max(1000, opts.ttlMs), 'NX');
  return { acquired: res === 'OK', key };
}

export async function releaseChatOutboxChannelLock(opts: { key: string | null; ownerId: string }): Promise<void> {
  const redis = getBullmqConnection();
  if (!redis || !opts.key) return;
  try {
    await redis.eval(RELEASE_LOCK_SCRIPT, 1, opts.key, opts.ownerId);
  } catch {
    // ignore
  }
}
