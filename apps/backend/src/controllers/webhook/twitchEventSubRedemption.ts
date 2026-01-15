import { prisma } from '../../lib/prisma.js';
import { getStreamDurationSnapshot } from '../../realtime/streamDurationStore.js';
import { twitchRedemptionEventSchema } from '../../shared/schemas.js';
import { resolveMemalertsUserIdFromChatIdentity } from '../../utils/chatIdentity.js';
import { logger } from '../../utils/logger.js';
import { emitWalletEvents, recordAndMaybeClaim } from './twitchEventSubRewards.js';
import { parseTwitchAutoRewards, safeNum, type ChannelForRedemption, type EventSubContext } from './twitchEventSubShared.js';

export async function handleTwitchRedemptionEvent(ctx: EventSubContext): Promise<boolean> {
  if (ctx.subscriptionType !== 'channel.channel_points_custom_reward_redemption.add') return false;

  try {
    const event = twitchRedemptionEventSchema.parse(ctx.req.body.event);

    const channel = (await prisma.channel.findUnique({
      where: { twitchChannelId: event.broadcaster_user_id },
      select: {
        id: true,
        slug: true,
        rewardIdForCoins: true,
        coinPerPointRatio: true,
        rewardOnlyWhenLive: true,
        twitchAutoRewardsJson: true,
      },
    })) as ChannelForRedemption | null;

    if (!channel) {
      ctx.res.status(200).json({ message: 'Channel not found, ignoring' });
      return true;
    }

    const cfg = parseTwitchAutoRewards(channel.twitchAutoRewardsJson);
    const channelPoints = cfg?.channelPoints;
    const byRewardIdCoins = safeNum(channelPoints?.byRewardId?.[event.reward.id]);
    const ruleEnabled = Boolean(channelPoints?.enabled);
    const mappedCoins = Number.isFinite(byRewardIdCoins) && byRewardIdCoins > 0 ? Math.floor(byRewardIdCoins) : 0;

    const legacyEnabled = Boolean(channel.rewardIdForCoins && channel.rewardIdForCoins === event.reward.id);
    const legacyCoins = legacyEnabled ? Math.floor(event.reward.cost * safeNum(channel.coinPerPointRatio ?? 1)) : 0;

    const coinsGranted = ruleEnabled ? mappedCoins : legacyCoins;
    const shouldCheckLive =
      channelPoints?.onlyWhenLive !== undefined
        ? Boolean(channelPoints.onlyWhenLive)
        : Boolean(channel.rewardOnlyWhenLive);

    if (coinsGranted > 0) {
      if (shouldCheckLive) {
        const snap = await getStreamDurationSnapshot(String(channel.slug || '').toLowerCase());
        if (snap.status !== 'online') {
          await recordAndMaybeClaim(ctx.rawBody, {
            channelId: channel.id,
            providerEventId: String(event.id),
            providerAccountId: String(event.user_id),
            eventType: 'twitch_channel_points_redemption',
            currency: 'twitch_channel_points',
            amount: event.reward.cost,
            coinsToGrant: 0,
            status: 'ignored',
            reason: 'offline',
            eventAt: new Date(event.redeemed_at),
          });
          ctx.res
            .status(200)
            .json({ message: 'Redemption skipped (offline)', errorCode: 'REWARD_DISABLED_OFFLINE' });
          return true;
        }
      }

      const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({
        provider: 'twitch',
        platformUserId: event.user_id,
      });
      const outcome = await recordAndMaybeClaim(ctx.rawBody, {
        channelId: channel.id,
        providerEventId: String(event.id),
        providerAccountId: String(event.user_id),
        eventType: 'twitch_channel_points_redemption',
        currency: 'twitch_channel_points',
        amount: event.reward.cost,
        coinsToGrant: coinsGranted,
        status: 'eligible',
        reason: null,
        eventAt: new Date(event.redeemed_at),
        linkedUserId,
      });

      if (linkedUserId) {
        try {
          await prisma.redemption.create({
            data: {
              channelId: channel.id,
              userId: linkedUserId,
              twitchRedemptionId: event.id,
              pointsSpent: event.reward.cost,
              coinsGranted,
              status: 'completed',
            },
            select: { id: true },
          });
        } catch {
          // ignore
        }
      }

      emitWalletEvents(ctx.req, outcome.claimedWalletEvents);
    }

    ctx.res.status(200).json({ message: 'Redemption processed' });
    return true;
  } catch (error) {
    const err = error as Error;
    logger.error('webhook.redemption_failed', { errorMessage: err.message });
    ctx.res.status(500).json({ error: 'Internal server error' });
    return true;
  }
}
