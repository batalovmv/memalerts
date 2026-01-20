import { getBullmqConnection, getBullmqPrefix } from './bullmqConnection.js';
import type { ChatOutboxPlatform } from './chatOutboxQueue.js';

type LocalEntry = { count: number; resetAtMs: number };

const local = new Map<string, LocalEntry>();

function nowMs(): number {
  return Date.now();
}

function buildKey(platform: ChatOutboxPlatform, channelId: string): string {
  return `${getBullmqPrefix()}:chat-outbox-rate:${platform}:${channelId}`;
}

export async function checkChatOutboxChannelRateLimit(params: {
  platform: ChatOutboxPlatform;
  channelId: string;
  max: number;
  windowMs: number;
}): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const max = Math.max(1, Math.floor(params.max));
  const windowMs = Math.max(1000, Math.floor(params.windowMs));
  const key = buildKey(params.platform, params.channelId);

  const client = getBullmqConnection();
  if (!client) {
    const now = nowMs();
    const entry = local.get(key);
    if (!entry || now >= entry.resetAtMs) {
      local.set(key, { count: 1, resetAtMs: now + windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }
    entry.count += 1;
    if (entry.count > max) {
      return { allowed: false, retryAfterMs: Math.max(0, entry.resetAtMs - now) };
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  const script = `
    local current = redis.call("INCR", KEYS[1])
    if tonumber(current) == 1 then
      redis.call("PEXPIRE", KEYS[1], ARGV[1])
    end
    local ttl = redis.call("PTTL", KEYS[1])
    return { current, ttl }
  `;

  try {
    const res = (await client.eval(script, 1, key, String(windowMs))) as unknown as [number, number];
    const count = Number(res?.[0] ?? 0);
    const ttl = Number(res?.[1] ?? 0);
    if (count > max) {
      return { allowed: false, retryAfterMs: Math.max(0, ttl || windowMs) };
    }
    return { allowed: true, retryAfterMs: 0 };
  } catch {
    const now = nowMs();
    const entry = local.get(key);
    if (!entry || now >= entry.resetAtMs) {
      local.set(key, { count: 1, resetAtMs: now + windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }
    entry.count += 1;
    if (entry.count > max) {
      return { allowed: false, retryAfterMs: Math.max(0, entry.resetAtMs - now) };
    }
    return { allowed: true, retryAfterMs: 0 };
  }
}
