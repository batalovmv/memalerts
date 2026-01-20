import type { Store } from 'express-rate-limit';
import { getRedisClient, getRedisNamespace, isRedisEnabled } from './redisClient.js';

type IncrementResult = { totalHits: number; resetTime: Date };

type LocalEntry = { totalHits: number; resetAtMs: number };

function safeNowMs(): number {
  return Date.now();
}

export class RedisBackedRateLimitStore implements Store {
  // `express-rate-limit` calls init() with windowMs.
  windowMs = 60_000;
  readonly prefix: string;
  private readonly local = new Map<string, LocalEntry>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  init(options: { windowMs?: number } | undefined) {
    const ms = Number(options?.windowMs);
    if (Number.isFinite(ms) && ms > 0) this.windowMs = ms;
    this.startCleanup();
  }

  private key(k: string): string {
    // Keep prod/beta isolated.
    return `memalerts:${getRedisNamespace()}:ratelimit:${this.prefix}:${k}`;
  }

  private localIncrement(k: string): IncrementResult {
    this.pruneLocal();
    const now = safeNowMs();
    const entry = this.local.get(k);
    if (!entry || now >= entry.resetAtMs) {
      const resetAtMs = now + this.windowMs;
      this.local.set(k, { totalHits: 1, resetAtMs });
      return { totalHits: 1, resetTime: new Date(resetAtMs) };
    }
    entry.totalHits += 1;
    return { totalHits: entry.totalHits, resetTime: new Date(entry.resetAtMs) };
  }

  private pruneLocal() {
    if (this.local.size === 0) return;
    const now = safeNowMs();
    for (const [key, entry] of this.local.entries()) {
      if (now >= entry.resetAtMs) {
        this.local.delete(key);
      }
    }
  }

  private startCleanup() {
    if (this.cleanupTimer) return;
    const intervalMs = Math.max(60_000, Math.floor(this.windowMs / 2));
    this.cleanupTimer = setInterval(() => this.pruneLocal(), intervalMs);
    this.cleanupTimer.unref?.();
  }

  async increment(key: string): Promise<IncrementResult> {
    if (!isRedisEnabled()) return this.localIncrement(key);

    const client = await getRedisClient();
    if (!client) return this.localIncrement(key);

    // Atomic counter + expiry:
    // - INCR
    // - if first hit, set PEXPIRE window
    // - return count + ttl
    const script = `
      local current = redis.call("INCR", KEYS[1])
      if tonumber(current) == 1 then
        redis.call("PEXPIRE", KEYS[1], ARGV[1])
      end
      local ttl = redis.call("PTTL", KEYS[1])
      return { current, ttl }
    `;

    try {
      const redisKey = this.key(key);
      const res = (await client.eval(script, {
        keys: [redisKey],
        arguments: [String(this.windowMs)],
      })) as unknown as [number, number];

      const totalHits = Number(res?.[0] ?? 0);
      const ttlMs = Number(res?.[1] ?? -1);
      const resetTime = ttlMs > 0 ? new Date(safeNowMs() + ttlMs) : new Date(safeNowMs() + this.windowMs);
      return { totalHits, resetTime };
    } catch {
      // If Redis is flaky, fall back to in-process limiting rather than disabling limits.
      return this.localIncrement(key);
    }
  }

  async decrement(key: string): Promise<void> {
    // Best-effort.
    const entry = this.local.get(key);
    if (entry) entry.totalHits = Math.max(0, entry.totalHits - 1);

    if (!isRedisEnabled()) return;
    const client = await getRedisClient();
    if (!client) return;
    try {
      await client.decr(this.key(key));
    } catch {
      // ignore
    }
  }

  async resetKey(key: string): Promise<void> {
    this.local.delete(key);
    if (!isRedisEnabled()) return;
    const client = await getRedisClient();
    if (!client) return;
    try {
      await client.del(this.key(key));
    } catch {
      // ignore
    }
  }
}

export function maybeCreateRateLimitStore(prefix: string): Store | undefined {
  // Allow explicit opt-out.
  const enabledRaw = String(process.env.RATE_LIMIT_REDIS ?? '').toLowerCase();
  const enabled = !(enabledRaw === '0' || enabledRaw === 'false' || enabledRaw === 'off');
  if (!enabled) return undefined;
  return new RedisBackedRateLimitStore(prefix);
}
