import { prisma } from '../../lib/prisma.js';
import { handleStreamOffline, handleStreamOnline } from '../../realtime/streamStatusStore.js';
import { endStreamSession, startStreamSession } from '../../services/economy/streamSessions.js';
import { logger } from '../../utils/logger.js';
import { type EventSubContext } from './twitchEventSubShared.js';

export async function handleTwitchStreamSessionEvent(ctx: EventSubContext): Promise<boolean> {
  if (ctx.subscriptionType !== 'stream.online' && ctx.subscriptionType !== 'stream.offline') return false;

  try {
    const broadcasterId = String(ctx.req.body?.event?.broadcaster_user_id || '').trim();
    if (!broadcasterId) {
      ctx.res.status(200).json({ message: 'No broadcaster id, ignoring' });
      return true;
    }

    const channel = await prisma.channel.findUnique({
      where: { twitchChannelId: broadcasterId },
      select: { id: true, slug: true },
    });
    const slug = String(channel?.slug || '').toLowerCase();
    if (!slug) {
      ctx.res.status(200).json({ message: 'Channel not found, ignoring' });
      return true;
    }

    if (ctx.subscriptionType === 'stream.online') {
      await handleStreamOnline(slug);
      if (channel?.id) {
        await startStreamSession(channel.id, 'twitch');
      }
    } else {
      await handleStreamOffline(slug);
      if (channel?.id) {
        await endStreamSession(channel.id);
      }
    }

    ctx.res.status(200).json({ message: 'Stream session processed' });
    return true;
  } catch (error) {
    const err = error as Error;
    logger.error('webhook.stream_session_failed', { errorMessage: err.message });
    ctx.res.status(200).json({ message: 'Stream session error (ignored)' });
    return true;
  }
}
