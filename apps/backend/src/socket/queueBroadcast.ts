import type { Server } from 'socket.io';
import { getQueueState } from '../services/queue/getQueueState.js';
import { logger } from '../utils/logger.js';

const pendingBroadcasts = new Map<string, NodeJS.Timeout>();
const COALESCE_MS = 50; // схлопывание за 50мс

let io: Server | null = null;

export function initQueueBroadcast(ioInstance: Server): void {
  io = ioInstance;
}

/**
 * Запланировать broadcast queue:state с троттлингом.
 * Если broadcast уже запланирован — не планируем повторно.
 */
export function broadcastQueueState(channelId: string): void {
  if (!io) {
    logger.warn('queue_broadcast.io_not_initialized', { channelId });
    return;
  }

  // Уже запланирован — пропускаем
  if (pendingBroadcasts.has(channelId)) return;

  const timeout = setTimeout(async () => {
    pendingBroadcasts.delete(channelId);

    try {
      const state = await getQueueState(channelId);
      io!.to(`channel:${channelId}`).emit('queue:state', state);
    } catch (error) {
      logger.error('queue_broadcast.failed', {
        channelId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Не ретраим — следующее изменение вызовет новый broadcast
    }
  }, COALESCE_MS);

  pendingBroadcasts.set(channelId, timeout);
}

/**
 * Немедленный broadcast (для первого подключения клиента)
 */
export async function broadcastQueueStateImmediate(channelId: string): Promise<void> {
  if (!io) return;

  // Отменить запланированный если есть
  const existing = pendingBroadcasts.get(channelId);
  if (existing) {
    clearTimeout(existing);
    pendingBroadcasts.delete(channelId);
  }

  try {
    const state = await getQueueState(channelId);
    io.to(`channel:${channelId}`).emit('queue:state', state);
  } catch (error) {
    logger.error('queue_broadcast.immediate_failed', {
      channelId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
