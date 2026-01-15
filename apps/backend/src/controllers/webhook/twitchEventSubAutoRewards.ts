import { prisma } from '../../lib/prisma.js';
import { getStreamDurationSnapshot } from '../../realtime/streamDurationStore.js';
import type { WalletUpdatedEvent } from '../../realtime/walletBridge.js';
import {
  twitchCheerEventSchema,
  twitchRaidEventSchema,
  twitchSubscribeEventSchema,
  twitchSubscriptionGiftEventSchema,
  twitchSubscriptionMessageEventSchema,
} from '../../shared/schemas.js';
import { resolveMemalertsUserIdFromChatIdentity } from '../../utils/chatIdentity.js';
import { logger } from '../../utils/logger.js';
import { emitWalletEvents, recordAndMaybeClaim } from './twitchEventSubRewards.js';
import {
  parseTwitchAutoRewards,
  readTierCoins,
  safeNum,
  type ChannelForAutoRewards,
  type EventSubContext,
  type TwitchCheerEvent,
  type TwitchRaidEvent,
  type TwitchSubscribeEvent,
  type TwitchSubscriptionGiftEvent,
  type TwitchSubscriptionMessageEvent,
} from './twitchEventSubShared.js';

const AUTO_REWARD_TYPES = new Set([
  'channel.subscribe',
  'channel.subscription.message',
  'channel.subscription.gift',
  'channel.cheer',
  'channel.raid',
]);

export async function handleTwitchAutoRewardsEvent(ctx: EventSubContext): Promise<boolean> {
  if (!AUTO_REWARD_TYPES.has(ctx.subscriptionType)) return false;

  try {
    const eventAt = new Date();

    const findChannel = async (broadcasterId: string): Promise<ChannelForAutoRewards | null> => {
      return (await prisma.channel.findUnique({
        where: { twitchChannelId: broadcasterId },
        select: { id: true, slug: true, twitchAutoRewardsJson: true },
      })) as ChannelForAutoRewards | null;
    };

    if (ctx.subscriptionType === 'channel.subscribe') {
      const ev: TwitchSubscribeEvent = twitchSubscribeEventSchema.parse(ctx.req.body.event);
      const channel = await findChannel(ev.broadcaster_user_id);
      if (!channel) {
        ctx.res.status(200).json({ message: 'Channel not found, ignoring' });
        return true;
      }
      const cfg = parseTwitchAutoRewards(channel.twitchAutoRewardsJson);
      const rule = cfg?.subscribe ?? null;
      if (!rule?.enabled) {
        ctx.res.status(200).json({ message: 'Auto rewards disabled' });
        return true;
      }

      const onlyWhenLive = Boolean(rule?.onlyWhenLive);
      if (onlyWhenLive) {
        const snap = await getStreamDurationSnapshot(String(channel.slug || '').toLowerCase());
        if (snap.status !== 'online') {
          ctx.res.status(200).json({ message: 'Auto reward skipped (offline)' });
          return true;
        }
      }

      const isPrime = Boolean(ev.is_prime);
      const tier = String(ev.tier || '').trim() || '1000';
      const tierCoins = readTierCoins(rule?.tierCoins ?? null, tier);
      const primeCoins = Math.floor(safeNum(rule?.primeCoins ?? 0));
      const coins = isPrime ? primeCoins || tierCoins : tierCoins;
      if (coins <= 0) {
        ctx.res.status(200).json({ message: 'Auto reward skipped (0 coins)' });
        return true;
      }

      const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({
        provider: 'twitch',
        platformUserId: ev.user_id,
      });
      const outcome = await recordAndMaybeClaim(ctx.rawBody, {
        channelId: channel.id,
        providerEventId: `${ctx.messageId}:sub`,
        providerAccountId: ev.user_id,
        eventType: 'twitch_subscribe',
        currency: 'twitch_units',
        amount: 1,
        coinsToGrant: coins,
        status: 'eligible',
        reason: null,
        eventAt,
        linkedUserId,
      });

      emitWalletEvents(ctx.req, outcome.claimedWalletEvents);
      ctx.res.status(200).json({ message: 'Auto reward processed' });
      return true;
    }

    if (ctx.subscriptionType === 'channel.subscription.message') {
      const ev: TwitchSubscriptionMessageEvent = twitchSubscriptionMessageEventSchema.parse(ctx.req.body.event);
      const channel = await findChannel(ev.broadcaster_user_id);
      if (!channel) {
        ctx.res.status(200).json({ message: 'Channel not found, ignoring' });
        return true;
      }
      const cfg = parseTwitchAutoRewards(channel.twitchAutoRewardsJson);
      const rule = cfg?.resubMessage ?? null;
      if (!rule?.enabled) {
        ctx.res.status(200).json({ message: 'Auto rewards disabled' });
        return true;
      }

      const onlyWhenLive = Boolean(rule?.onlyWhenLive);
      if (onlyWhenLive) {
        const snap = await getStreamDurationSnapshot(String(channel.slug || '').toLowerCase());
        if (snap.status !== 'online') {
          ctx.res.status(200).json({ message: 'Auto reward skipped (offline)' });
          return true;
        }
      }

      const tier = String(ev.tier || '').trim() || '1000';
      const tierCoins = readTierCoins(rule?.tierCoins ?? null, tier);
      const primeCoins = Math.floor(safeNum(rule?.primeCoins ?? 0));
      const bonus = Math.floor(safeNum(rule?.bonusCoins ?? 0));
      const coins = (primeCoins || tierCoins) + (bonus > 0 ? bonus : 0);
      if (coins <= 0) {
        ctx.res.status(200).json({ message: 'Auto reward skipped (0 coins)' });
        return true;
      }

      const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({
        provider: 'twitch',
        platformUserId: ev.user_id,
      });
      const outcome = await recordAndMaybeClaim(ctx.rawBody, {
        channelId: channel.id,
        providerEventId: `${ctx.messageId}:resub_msg`,
        providerAccountId: ev.user_id,
        eventType: 'twitch_resub_message',
        currency: 'twitch_units',
        amount: 1,
        coinsToGrant: coins,
        status: 'eligible',
        reason: null,
        eventAt,
        linkedUserId,
      });

      emitWalletEvents(ctx.req, outcome.claimedWalletEvents);
      ctx.res.status(200).json({ message: 'Auto reward processed' });
      return true;
    }

    if (ctx.subscriptionType === 'channel.subscription.gift') {
      const ev: TwitchSubscriptionGiftEvent = twitchSubscriptionGiftEventSchema.parse(ctx.req.body.event);
      const channel = await findChannel(ev.broadcaster_user_id);
      if (!channel) {
        ctx.res.status(200).json({ message: 'Channel not found, ignoring' });
        return true;
      }
      const cfg = parseTwitchAutoRewards(channel.twitchAutoRewardsJson);
      const rule = cfg?.giftSub ?? null;
      if (!rule?.enabled) {
        ctx.res.status(200).json({ message: 'Auto rewards disabled' });
        return true;
      }

      const onlyWhenLive = Boolean(rule?.onlyWhenLive);
      if (onlyWhenLive) {
        const snap = await getStreamDurationSnapshot(String(channel.slug || '').toLowerCase());
        if (snap.status !== 'online') {
          ctx.res.status(200).json({ message: 'Auto reward skipped (offline)' });
          return true;
        }
      }

      const tier = String(ev.tier || '').trim() || '1000';
      const total = Math.max(1, Math.floor(safeNum(ev.total ?? 1)));
      const giverCoinsPerOne = readTierCoins(rule?.giverTierCoins ?? null, tier);
      const giverCoins = giverCoinsPerOne > 0 ? giverCoinsPerOne * total : 0;
      const recipientCoins = Math.floor(safeNum(rule?.recipientCoins ?? 0));

      const claimedEvents: WalletUpdatedEvent[] = [];

      const giverId = String(ev.user_id || '').trim();
      if (giverId && giverCoins > 0) {
        const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({
          provider: 'twitch',
          platformUserId: giverId,
        });
        const o = await recordAndMaybeClaim(ctx.rawBody, {
          channelId: channel.id,
          providerEventId: `${ctx.messageId}:gift_giver`,
          providerAccountId: giverId,
          eventType: 'twitch_gift_sub',
          currency: 'twitch_units',
          amount: total,
          coinsToGrant: giverCoins,
          status: 'eligible',
          reason: null,
          eventAt,
          linkedUserId,
        });
        if (o.claimedWalletEvents.length) claimedEvents.push(...o.claimedWalletEvents);
      }

      const recipientId = String(ev.recipient_user_id || '').trim();
      if (recipientId && recipientCoins > 0) {
        const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({
          provider: 'twitch',
          platformUserId: recipientId,
        });
        const o = await recordAndMaybeClaim(ctx.rawBody, {
          channelId: channel.id,
          providerEventId: `${ctx.messageId}:gift_recipient:${recipientId}`,
          providerAccountId: recipientId,
          eventType: 'twitch_gift_sub',
          currency: 'twitch_units',
          amount: 1,
          coinsToGrant: recipientCoins,
          status: 'eligible',
          reason: null,
          eventAt,
          linkedUserId,
        });
        if (o.claimedWalletEvents.length) claimedEvents.push(...o.claimedWalletEvents);
      }

      emitWalletEvents(ctx.req, claimedEvents);
      ctx.res.status(200).json({ message: 'Auto reward processed' });
      return true;
    }

    if (ctx.subscriptionType === 'channel.cheer') {
      const ev: TwitchCheerEvent = twitchCheerEventSchema.parse(ctx.req.body.event);
      const channel = await findChannel(ev.broadcaster_user_id);
      if (!channel) {
        ctx.res.status(200).json({ message: 'Channel not found, ignoring' });
        return true;
      }
      const cfg = parseTwitchAutoRewards(channel.twitchAutoRewardsJson);
      const rule = cfg?.cheer ?? null;
      if (!rule?.enabled) {
        ctx.res.status(200).json({ message: 'Auto rewards disabled' });
        return true;
      }

      const onlyWhenLive = Boolean(rule?.onlyWhenLive);
      if (onlyWhenLive) {
        const snap = await getStreamDurationSnapshot(String(channel.slug || '').toLowerCase());
        if (snap.status !== 'online') {
          ctx.res.status(200).json({ message: 'Auto reward skipped (offline)' });
          return true;
        }
      }

      const userId = String(ev.user_id || '').trim();
      const bits = Math.max(0, Math.floor(safeNum(ev.bits ?? 0)));
      if (!userId || bits <= 0) {
        ctx.res.status(200).json({ message: 'Auto reward skipped' });
        return true;
      }

      const minBits = Math.max(1, Math.floor(safeNum(rule?.minBits ?? 1)));
      if (bits < minBits) {
        ctx.res.status(200).json({ message: 'Auto reward skipped (below minBits)' });
        return true;
      }

      const bitsPerCoin = Math.max(1, Math.floor(safeNum(rule?.bitsPerCoin ?? 1)));
      const coins = Math.floor(bits / bitsPerCoin);
      if (coins <= 0) {
        ctx.res.status(200).json({ message: 'Auto reward skipped (0 coins)' });
        return true;
      }

      const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({
        provider: 'twitch',
        platformUserId: userId,
      });
      const outcome = await recordAndMaybeClaim(ctx.rawBody, {
        channelId: channel.id,
        providerEventId: `${ctx.messageId}:cheer`,
        providerAccountId: userId,
        eventType: 'twitch_cheer',
        currency: 'twitch_bits',
        amount: bits,
        coinsToGrant: coins,
        status: 'eligible',
        reason: null,
        eventAt,
        linkedUserId,
      });

      emitWalletEvents(ctx.req, outcome.claimedWalletEvents);
      ctx.res.status(200).json({ message: 'Auto reward processed' });
      return true;
    }

    if (ctx.subscriptionType === 'channel.raid') {
      const ev: TwitchRaidEvent = twitchRaidEventSchema.parse(ctx.req.body.event);
      const channel = await findChannel(ev.to_broadcaster_user_id);
      if (!channel) {
        ctx.res.status(200).json({ message: 'Channel not found, ignoring' });
        return true;
      }
      const cfg = parseTwitchAutoRewards(channel.twitchAutoRewardsJson);
      const rule = cfg?.raid ?? null;
      if (!rule?.enabled) {
        ctx.res.status(200).json({ message: 'Auto rewards disabled' });
        return true;
      }

      const onlyWhenLive = Boolean(rule?.onlyWhenLive);
      if (onlyWhenLive) {
        const snap = await getStreamDurationSnapshot(String(channel.slug || '').toLowerCase());
        if (snap.status !== 'online') {
          ctx.res.status(200).json({ message: 'Auto reward skipped (offline)' });
          return true;
        }
      }

      const raiderId = String(ev.from_broadcaster_user_id || '').trim();
      const viewers = Math.max(0, Math.floor(safeNum(ev.viewer_count ?? 0)));
      if (!raiderId) {
        ctx.res.status(200).json({ message: 'Auto reward skipped' });
        return true;
      }

      const baseCoins = Math.floor(safeNum(rule?.baseCoins ?? 0));
      const perViewer = Math.floor(safeNum(rule?.coinsPerViewer ?? 0));
      const minViewers = Math.floor(safeNum(rule?.minViewers ?? 0));
      if (minViewers > 0 && viewers < minViewers) {
        ctx.res.status(200).json({ message: 'Auto reward skipped (minViewers)' });
        return true;
      }
      const coins = baseCoins + Math.max(0, perViewer) * viewers;
      if (coins <= 0) {
        ctx.res.status(200).json({ message: 'Auto reward skipped (0 coins)' });
        return true;
      }

      const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({
        provider: 'twitch',
        platformUserId: raiderId,
      });
      const outcome = await recordAndMaybeClaim(ctx.rawBody, {
        channelId: channel.id,
        providerEventId: `${ctx.messageId}:raid`,
        providerAccountId: raiderId,
        eventType: 'twitch_raid',
        currency: 'twitch_units',
        amount: viewers,
        coinsToGrant: coins,
        status: 'eligible',
        reason: null,
        eventAt,
        linkedUserId,
      });

      emitWalletEvents(ctx.req, outcome.claimedWalletEvents);
      ctx.res.status(200).json({ message: 'Auto reward processed' });
      return true;
    }

    ctx.res.status(200).json({ message: 'Auto reward ignored' });
    return true;
  } catch (error) {
    const err = error as Error;
    logger.error('webhook.auto_reward_failed', { errorMessage: err.message });
    ctx.res.status(200).json({ message: 'Auto reward error (ignored)' });
    return true;
  }
}
