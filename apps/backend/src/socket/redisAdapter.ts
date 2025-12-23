import type { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { logger } from '../utils/logger.js';
import { isRedisEnabled } from '../utils/redisClient.js';

export async function maybeSetupSocketIoRedisAdapter(io: Server): Promise<void> {
  if (!isRedisEnabled()) return;

  const url = String(process.env.REDIS_URL || '').trim();
  if (!url) return;

  // Socket.IO adapter needs pub/sub clients.
  const pubClient = createClient({ url });
  const subClient = pubClient.duplicate();

  try {
    await pubClient.connect();
    await subClient.connect();
    io.adapter(createAdapter(pubClient, subClient));
    logger.info('socket.redis_adapter.enabled', {});
  } catch (e: any) {
    logger.warn('socket.redis_adapter.failed', { errorMessage: e?.message || String(e) });
    try {
      await pubClient.disconnect();
    } catch {}
    try {
      await subClient.disconnect();
    } catch {}
  }
}


