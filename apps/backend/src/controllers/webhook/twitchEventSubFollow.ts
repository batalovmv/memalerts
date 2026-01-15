import { enqueueChatOutboxJob } from '../../queues/chatOutboxQueue.js';
import { prisma } from '../../lib/prisma.js';
import { getStreamDurationSnapshot } from '../../realtime/streamDurationStore.js';
import { twitchFollowEventSchema } from '../../shared/schemas.js';
import { stableProviderEventId } from '../../rewards/externalRewardEvents.js';
import { resolveMemalertsUserIdFromChatIdentity } from '../../utils/chatIdentity.js';
import { logger } from '../../utils/logger.js';
import { emitWalletEvents, recordAndMaybeClaim } from './twitchEventSubRewards.js';
import {
  parseTwitchAutoRewards,
  safeNum,
  type ChannelForFollow,
  type EventSubContext,
} from './twitchEventSubShared.js';

export async function handleTwitchFollowEvent(ctx: EventSubContext): Promise<boolean> {
  if (ctx.subscriptionType !== 'channel.follow') return false;

  try {
    const event = twitchFollowEventSchema.parse(ctx.req.body.event);

    const channel = (await prisma.channel.findUnique({
      where: { twitchChannelId: event.broadcaster_user_id },
      select: {
        id: true,
        followGreetingsEnabled: true,
        followGreetingTemplate: true,
        twitchAutoRewardsJson: true,
        slug: true,
      },
    })) as ChannelForFollow | null;
    if (!channel) {
      ctx.res.status(200).json({ message: 'Channel not found, ignoring' });
      return true;
    }

    try {
      const cfg = parseTwitchAutoRewards(channel.twitchAutoRewardsJson);
      const rule = cfg?.follow ?? null;
      const enabled = Boolean(rule?.enabled);
      const coins = Math.floor(safeNum(rule?.coins ?? 0));
      const onceEver = rule?.onceEver === undefined ? true : Boolean(rule?.onceEver);
      const onlyWhenLive = Boolean(rule?.onlyWhenLive);

      if (enabled && coins > 0) {
        const providerEventId = onceEver
          ? stableProviderEventId({
              provider: 'twitch',
              rawPayloadJson: '{}',
              fallbackParts: ['follow', channel.id, event.user_id],
            })
          : `${ctx.messageId}:follow`;

        if (onlyWhenLive) {
          const snap = await getStreamDurationSnapshot(String(channel.slug || '').toLowerCase());
          if (snap.status !== 'online') {
            await recordAndMaybeClaim(ctx.rawBody, {
              channelId: channel.id,
              providerEventId,
              providerAccountId: event.user_id,
              eventType: 'twitch_follow',
              currency: 'twitch_units',
              amount: 1,
              coinsToGrant: 0,
              status: 'ignored',
              reason: 'offline',
              eventAt: new Date(event.followed_at),
            });
          } else {
            const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({
              provider: 'twitch',
              platformUserId: event.user_id,
            });
            const outcome = await recordAndMaybeClaim(ctx.rawBody, {
              channelId: channel.id,
              providerEventId,
              providerAccountId: event.user_id,
              eventType: 'twitch_follow',
              currency: 'twitch_units',
              amount: 1,
              coinsToGrant: coins,
              status: 'eligible',
              reason: null,
              eventAt: new Date(event.followed_at),
              linkedUserId,
            });
            emitWalletEvents(ctx.req, outcome.claimedWalletEvents);
          }
        } else {
          const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({
            provider: 'twitch',
            platformUserId: event.user_id,
          });
          const outcome = await recordAndMaybeClaim(ctx.rawBody, {
            channelId: channel.id,
            providerEventId,
            providerAccountId: event.user_id,
            eventType: 'twitch_follow',
            currency: 'twitch_units',
            amount: 1,
            coinsToGrant: coins,
            status: 'eligible',
            reason: null,
            eventAt: new Date(event.followed_at),
            linkedUserId,
          });
          emitWalletEvents(ctx.req, outcome.claimedWalletEvents);
        }
      }
    } catch {
      // ignore auto-rewards failures (follow greeting must still work)
    }

    if (!channel.followGreetingsEnabled) {
      ctx.res.status(200).json({ message: 'Follow greetings disabled' });
      return true;
    }

    try {
      await prisma.chatBotEventDedup.create({
        data: { channelId: channel.id, kind: 'follow', eventId: ctx.messageId },
        select: { id: true },
      });
    } catch (error: unknown) {
      const errorCode =
        typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;
      if (errorCode === 'P2002') {
        ctx.res.status(200).json({ message: 'Duplicate follow ignored' });
        return true;
      }
      throw error;
    }

    const sub = await prisma.chatBotSubscription.findUnique({
      where: { channelId: channel.id },
      select: { enabled: true, twitchLogin: true },
    });
    if (!sub?.enabled || !sub.twitchLogin) {
      ctx.res.status(200).json({ message: 'Bot not enabled for channel, ignoring' });
      return true;
    }

    const template = String(channel.followGreetingTemplate || 'Спасибо за фоллоу, {user}!').trim();
    const msg = template.replace(/\{user\}/g, event.user_name);
    if (!msg) {
      ctx.res.status(200).json({ message: 'Empty greeting, ignoring' });
      return true;
    }

    const outboxRow = await prisma.chatBotOutboxMessage.create({
      data: { channelId: channel.id, twitchLogin: sub.twitchLogin, message: msg, status: 'pending' },
      select: { id: true },
    });
    void enqueueChatOutboxJob({ platform: 'twitch', outboxId: outboxRow.id, channelId: channel.id });

    ctx.res.status(200).json({ message: 'Follow greeting enqueued' });
    return true;
  } catch (error) {
    const err = error as Error;
    logger.error('webhook.follow_failed', { errorMessage: err.message });
    ctx.res.status(200).json({ message: 'Follow event error (ignored)' });
    return true;
  }
}
