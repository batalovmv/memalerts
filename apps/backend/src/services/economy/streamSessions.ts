import type { StreamProvider } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';

export async function getActiveStreamSession(channelId: string) {
  if (!channelId) return null;
  return prisma.streamSession.findFirst({
    where: { channelId, endedAt: null },
    orderBy: { startedAt: 'desc' },
  });
}

export async function startStreamSession(channelId: string, provider: StreamProvider = 'unknown') {
  if (!channelId) return null;
  const existing = await getActiveStreamSession(channelId);
  if (existing) {
    if (existing.provider === 'unknown' && provider !== 'unknown') {
      try {
        await prisma.streamSession.update({
          where: { id: existing.id },
          data: { provider },
        });
      } catch (error) {
        logger.warn('stream_session.provider_update_failed', {
          channelId,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return existing;
  }

  return prisma.streamSession.create({
    data: {
      channelId,
      provider,
      startedAt: new Date(),
    },
  });
}

export async function endStreamSession(channelId: string) {
  if (!channelId) return null;
  const existing = await getActiveStreamSession(channelId);
  if (!existing) return null;
  return prisma.streamSession.update({
    where: { id: existing.id },
    data: { endedAt: new Date() },
  });
}
