import { getRedisClient, getRedisNamespace } from './redisClient.js';

export async function redisGetString(key: string): Promise<string | null> {
  const client = await getRedisClient();
  if (!client) return null;
  try {
    return await client.get(key);
  } catch {
    return null;
  }
}

export async function redisSetStringEx(key: string, ttlSeconds: number, value: string): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;
  try {
    const ttl = Math.max(1, Math.min(24 * 60 * 60, Math.floor(ttlSeconds)));
    await client.setEx(key, ttl, value);
  } catch {
    // ignore
  }
}

export async function redisDel(key: string): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;
  try {
    await client.del(key);
  } catch {
    // ignore
  }
}

export function nsKey(kind: string, key: string): string {
  return `memalerts:${getRedisNamespace()}:${kind}:${key}`;
}
