import { prisma } from '../lib/prisma.js';
import { getStreamDurationSnapshot } from '../realtime/streamDurationStore.js';
import { recordExternalRewardEventTx, stableProviderEventId } from '../rewards/externalRewardEvents.js';
import { claimPendingCoinGrantsTx } from '../rewards/pendingCoinGrants.js';
import { resolveMemalertsUserIdFromChatIdentity } from '../utils/chatIdentity.js';
import { logger } from '../utils/logger.js';
import { asRecord, getErrorMessage, prismaAny } from './vkvideoChatbotShared.js';
import {
  extractVkVideoChannelPointsRedemption,
  extractVkVideoFollowOrSubscriptionAlert,
} from './vkvideoRewardUtils.js';
export { handleVkvideoChatAutoRewards } from './vkvideoChatAutoRewards.js';

type RewardTx = Parameters<typeof recordExternalRewardEventTx>[0]['tx'];

type RewardPushParams = {
  vkvideoChannelId: string;
  channelId: string | null;
  channelSlug: string;
  pushData: unknown;
  autoRewardsCfg: unknown | null;
};

async function processFollowOrSubscribe(
  params: RewardPushParams,
  alert: ReturnType<typeof extractVkVideoFollowOrSubscriptionAlert>
): Promise<void> {
  if (!alert || !params.channelId) return;
  const channelId = params.channelId;
  const slug = params.channelSlug;

  const rawPayloadJson = JSON.stringify(params.pushData ?? {});
  const cfgRec =
    params.autoRewardsCfg && typeof params.autoRewardsCfg === 'object' ? asRecord(params.autoRewardsCfg) : {};
  const rule = alert.kind === 'follow' ? asRecord(cfgRec.follow) : asRecord(cfgRec.subscribe);
  const enabled = Boolean(rule.enabled);
  const coins =
    alert.kind === 'follow' ? Math.floor(Number(rule.coins ?? 0)) : Math.floor(Number(rule.primeCoins ?? 0)); // VKVideo has no tier info; use primeCoins as a single-value knob.
  const onlyWhenLive = Boolean(rule.onlyWhenLive);
  const onceEver = alert.kind === 'follow' ? (rule.onceEver === undefined ? true : Boolean(rule.onceEver)) : true;

  const providerEventId =
    alert.providerEventId ||
    (onceEver
      ? stableProviderEventId({
          provider: 'vkvideo',
          rawPayloadJson: '{}',
          fallbackParts: [alert.kind, channelId, alert.providerAccountId],
        })
      : stableProviderEventId({
          provider: 'vkvideo',
          rawPayloadJson,
          fallbackParts: [
            alert.kind,
            params.vkvideoChannelId,
            alert.providerAccountId,
            String(alert.eventAt?.getTime?.() || ''),
          ],
        }));

  if (!enabled || coins <= 0) {
    await prisma.$transaction(async (tx: RewardTx) => {
      await recordExternalRewardEventTx({
        tx,
        provider: 'vkvideo',
        providerEventId,
        channelId,
        providerAccountId: alert.providerAccountId,
        eventType: alert.kind === 'follow' ? 'twitch_follow' : 'twitch_subscribe',
        currency: 'twitch_units',
        amount: 1,
        coinsToGrant: 0,
        status: 'ignored',
        reason: enabled ? 'zero_coins' : 'auto_rewards_disabled',
        eventAt: alert.eventAt,
        rawPayloadJson,
      });
    });
    return;
  }

  if (onlyWhenLive) {
    const snap = await getStreamDurationSnapshot(String(slug || '').toLowerCase());
    if (snap.status !== 'online') {
      await prisma.$transaction(async (tx: RewardTx) => {
        await recordExternalRewardEventTx({
          tx,
          provider: 'vkvideo',
          providerEventId,
          channelId,
          providerAccountId: alert.providerAccountId,
          eventType: alert.kind === 'follow' ? 'twitch_follow' : 'twitch_subscribe',
          currency: 'twitch_units',
          amount: 1,
          coinsToGrant: 0,
          status: 'ignored',
          reason: 'offline',
          eventAt: alert.eventAt,
          rawPayloadJson,
        });
      });
      return;
    }
  }

  const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({
    provider: 'vkvideo',
    platformUserId: alert.providerAccountId,
  });
  await prisma.$transaction(async (tx: RewardTx) => {
    await recordExternalRewardEventTx({
      tx,
      provider: 'vkvideo',
      providerEventId,
      channelId,
      providerAccountId: alert.providerAccountId,
      eventType: alert.kind === 'follow' ? 'twitch_follow' : 'twitch_subscribe',
      currency: 'twitch_units',
      amount: 1,
      coinsToGrant: coins,
      status: 'eligible',
      reason: null,
      eventAt: alert.eventAt,
      rawPayloadJson,
    });

    if (linkedUserId) {
      await claimPendingCoinGrantsTx({
        tx,
        userId: linkedUserId,
        provider: 'vkvideo',
        providerAccountId: alert.providerAccountId,
      });
    }
  });
}

async function processChannelPoints(
  params: RewardPushParams,
  redemption: ReturnType<typeof extractVkVideoChannelPointsRedemption>
): Promise<void> {
  if (!redemption || !params.channelId) return;
  const channelId = params.channelId;
  const slug = params.channelSlug;

  const rawPayloadJson = JSON.stringify(params.pushData ?? {});
  const providerEventId =
    redemption.providerEventId ||
    stableProviderEventId({
      provider: 'vkvideo',
      rawPayloadJson,
      fallbackParts: [
        params.vkvideoChannelId,
        redemption.providerAccountId,
        String(redemption.amount),
        redemption.rewardId || '',
      ],
    });

  const channel = await prismaAny.channel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      slug: true,
      vkvideoRewardEnabled: true,
      vkvideoRewardIdForCoins: true,
      vkvideoCoinPerPointRatio: true,
      vkvideoRewardCoins: true,
      vkvideoRewardOnlyWhenLive: true,
    },
  });
  if (!channel) return;

  const enabled = Boolean(channel.vkvideoRewardEnabled);
  const configuredRewardId = String(channel.vkvideoRewardIdForCoins || '').trim();
  const rewardIdOk = !configuredRewardId || !redemption.rewardId || configuredRewardId === redemption.rewardId;

  // Optional restriction: only when live (best-effort, keyed by MemAlerts slug).
  if (enabled && channel.vkvideoRewardOnlyWhenLive) {
    const snap = await getStreamDurationSnapshot(String(channel.slug || slug || '').toLowerCase());
    if (snap.status !== 'online') {
      await prisma.$transaction(async (tx: RewardTx) => {
        await recordExternalRewardEventTx({
          tx,
          provider: 'vkvideo',
          providerEventId,
          channelId: String(channel.id),
          providerAccountId: redemption.providerAccountId,
          eventType: 'vkvideo_channel_points_redemption',
          currency: 'vkvideo_channel_points',
          amount: redemption.amount,
          coinsToGrant: 0,
          status: 'ignored',
          reason: 'offline',
          eventAt: redemption.eventAt,
          rawPayloadJson,
        });
      });
      return;
    }
  }

  if (!enabled) {
    await prisma.$transaction(async (tx: RewardTx) => {
      await recordExternalRewardEventTx({
        tx,
        provider: 'vkvideo',
        providerEventId,
        channelId: String(channel.id),
        providerAccountId: redemption.providerAccountId,
        eventType: 'vkvideo_channel_points_redemption',
        currency: 'vkvideo_channel_points',
        amount: redemption.amount,
        coinsToGrant: 0,
        status: 'ignored',
        reason: 'vkvideo_reward_disabled',
        eventAt: redemption.eventAt,
        rawPayloadJson,
      });
    });
    return;
  }

  if (!rewardIdOk) {
    await prisma.$transaction(async (tx: RewardTx) => {
      await recordExternalRewardEventTx({
        tx,
        provider: 'vkvideo',
        providerEventId,
        channelId: String(channel.id),
        providerAccountId: redemption.providerAccountId,
        eventType: 'vkvideo_channel_points_redemption',
        currency: 'vkvideo_channel_points',
        amount: redemption.amount,
        coinsToGrant: 0,
        status: 'ignored',
        reason: 'reward_id_mismatch',
        eventAt: redemption.eventAt,
        rawPayloadJson,
      });
    });
    return;
  }

  const fixedCoins = channel.vkvideoRewardCoins ?? null;
  const ratio = Number(channel.vkvideoCoinPerPointRatio ?? 1.0);
  const coinsToGrant = fixedCoins
    ? Number(fixedCoins)
    : Math.floor(redemption.amount * (Number.isFinite(ratio) ? ratio : 1.0));

  const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({
    provider: 'vkvideo',
    platformUserId: redemption.providerAccountId,
  });

  await prisma.$transaction(async (tx: RewardTx) => {
    await recordExternalRewardEventTx({
      tx,
      provider: 'vkvideo',
      providerEventId,
      channelId: String(channel.id),
      providerAccountId: redemption.providerAccountId,
      eventType: 'vkvideo_channel_points_redemption',
      currency: 'vkvideo_channel_points',
      amount: redemption.amount,
      coinsToGrant,
      status: coinsToGrant > 0 ? 'eligible' : 'ignored',
      reason: coinsToGrant > 0 ? null : 'zero_coins',
      eventAt: redemption.eventAt,
      rawPayloadJson,
    });

    // If viewer already linked, claim immediately (no realtime emit here; runner is out-of-process).
    if (linkedUserId && coinsToGrant > 0) {
      await claimPendingCoinGrantsTx({
        tx,
        userId: linkedUserId,
        provider: 'vkvideo',
        providerAccountId: redemption.providerAccountId,
      });
    }
  });
}

export function handleVkvideoRewardPush(params: RewardPushParams): boolean {
  if (!params.channelId) return false;

  try {
    const alert = extractVkVideoFollowOrSubscriptionAlert(params.pushData);
    if (alert) {
      void processFollowOrSubscribe(params, alert);
      return true;
    }
  } catch (e: unknown) {
    logger.warn('vkvideo_chatbot.follow_sub_ingest_failed', { errorMessage: getErrorMessage(e) });
    return true;
  }

  try {
    const redemption = extractVkVideoChannelPointsRedemption(params.pushData);
    if (redemption) {
      void processChannelPoints(params, redemption);
      return true;
    }
  } catch (e: unknown) {
    logger.warn('vkvideo_chatbot.channel_points_ingest_failed', { errorMessage: getErrorMessage(e) });
    return true;
  }

  return false;
}
