import IORedis from 'ioredis';
import { logger } from '../utils/logger.js';
import { getRedisNamespace } from '../utils/redisClient.js';

let connection: IORedis | null = null;

function getRedisUrl(): string | null {
  const url = String(process.env.REDIS_URL || '').trim();
  return url ? url : null;
}

export function getBullmqPrefix(): string {
  const override = String(process.env.BULLMQ_PREFIX || '').trim();
  if (override) return override;
  const namespace = getRedisNamespace();
  return `memalerts:${namespace}`;
}

export function getBullmqConnection(): IORedis | null {
  const url = getRedisUrl();
  if (!url) return null;
  if (!connection) {
    connection = new IORedis(url, { maxRetriesPerRequest: null });
    connection.on('error', (err) => {
      const error = err as { message?: string };
      logger.warn('bullmq.redis_error', { errorMessage: error?.message || String(err) });
    });
    connection.on('connect', () => {
      logger.info('bullmq.redis_connected', {});
    });
  }
  return connection;
}

export async function closeBullmqConnection(): Promise<void> {
  if (!connection) return;
  try {
    await connection.quit();
  } catch {
    try {
      connection.disconnect();
    } catch {
      // ignore
    }
  } finally {
    connection = null;
  }
}
