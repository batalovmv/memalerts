import { prisma } from '../../lib/prisma.js';
import { markCreditsSessionOffline, startOrResumeCreditsSession } from '../../realtime/creditsSessionStore.js';
import { handleStreamOffline, handleStreamOnline } from '../../realtime/streamDurationStore.js';
import { logger } from '../../utils/logger.js';
import { type ChannelForCredits, type EventSubContext } from './twitchEventSubShared.js';

export async function handleTwitchStreamSessionEvent(ctx: EventSubContext): Promise<boolean> {
  if (ctx.subscriptionType !== 'stream.online' && ctx.subscriptionType !== 'stream.offline') return false;

  try {
    const broadcasterId = String(ctx.req.body?.event?.broadcaster_user_id || '').trim();
    if (!broadcasterId) {
      ctx.res.status(200).json({ message: 'No broadcaster id, ignoring' });
      return true;
    }

    const channel = (await prisma.channel.findUnique({
      where: { twitchChannelId: broadcasterId },
      select: { slug: true, creditsReconnectWindowMinutes: true, streamDurationCommandJson: true },
    })) as ChannelForCredits | null;
    const slug = String(channel?.slug || '').toLowerCase();
    if (!slug) {
      ctx.res.status(200).json({ message: 'Channel not found, ignoring' });
      return true;
    }
    const windowMin = Number.isFinite(channel?.creditsReconnectWindowMinutes)
      ? Number(channel?.creditsReconnectWindowMinutes)
      : 60;

    if (ctx.subscriptionType === 'stream.online') {
      await startOrResumeCreditsSession(slug, windowMin);
      let breakCreditMinutes = 60;
      try {
        const raw = String(channel?.streamDurationCommandJson || '').trim();
        if (raw) {
          const parsed = JSON.parse(raw) as { breakCreditMinutes?: unknown };
          const v = Number(parsed?.breakCreditMinutes);
          if (Number.isFinite(v)) breakCreditMinutes = v;
        }
      } catch {
        // ignore invalid JSON
      }
      await handleStreamOnline(slug, breakCreditMinutes);
    } else {
      await markCreditsSessionOffline(slug, windowMin);
      await handleStreamOffline(slug);
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
