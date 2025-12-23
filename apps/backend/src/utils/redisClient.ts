import { createClient, type RedisClientType } from 'redis';
import { logger } from './logger.js';

let clientPromise: Promise<RedisClientType> | null = null;

function getRedisUrl(): string | null {
  const url = String(process.env.REDIS_URL || '').trim();
  return url ? url : null;
}

export function isRedisEnabled(): boolean {
  return !!getRedisUrl();
}

export async function getRedisClient(): Promise<RedisClientType | null> {
  const url = getRedisUrl();
  if (!url) return null;

  if (!clientPromise) {
    const client: RedisClientType = createClient({ url });
    client.on('error', (err) => {
      logger.warn('redis.error', { errorMessage: (err as any)?.message || String(err) });
    });
    clientPromise = (async () => {
      await client.connect();
      logger.info('redis.connected', {});
      return client;
    })().catch((e) => {
      clientPromise = null;
      logger.warn('redis.connect_failed', { errorMessage: e?.message || String(e) });
      return null as any;
    }) as any;
  }

  try {
    return await clientPromise;
  } catch {
    return null;
  }
}

export function getRedisNamespace(): string {
  const isBeta = String(process.env.DOMAIN || '').includes('beta.') || String(process.env.PORT || '') === '3002';
  return isBeta ? 'beta' : 'prod';
}


