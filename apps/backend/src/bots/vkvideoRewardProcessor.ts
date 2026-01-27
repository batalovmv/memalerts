import { prisma } from '../lib/prisma.js';
import { getStreamStatusSnapshot } from '../realtime/streamStatusStore.js';
import { recordExternalRewardEventTx, stableProviderEventId } from '../rewards/externalRewardEvents.js';
import { claimPendingCoinGrantsTx } from '../rewards/pendingCoinGrants.js';
import { resolveMemalertsUserIdFromChatIdentity } from '../utils/chatIdentity.js';
import { logger } from '../utils/logger.js';
import { asRecord } from './vkvideoChatbotShared.js';

type RewardPushParams = {
  vkvideoChannelId: string;
  channelId: string | null;
  channelSlug: string;
  pushData: unknown;
};

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const ts = Date.parse(value);
    if (Number.isFinite(ts)) return new Date(ts);
  }
  return null;
}

function parseChannelPointsEvent(pushData: unknown): {
  providerEventId: string;
  userId: string;
  rewardId: string | null;
  amount: number;
  eventAt: Date | null;
} | null {
  const root = asRecord(pushData);
  const type = String(root.type ?? '').trim().toLowerCase();
  if (type !== 'channel_points') return null;

  const data = asRecord(root.data);
  const redemption = asRecord(data.redemption ?? data.event ?? root.redemption ?? root.event);
  const userRec = asRecord(redemption.user ?? redemption.redeemer ?? redemption.author);
  const rewardRec = asRecord(redemption.reward ?? redemption.reward_info ?? {});

  const userId = String(userRec.id ?? redemption.user_id ?? '').trim();
  const rewardId = String(rewardRec.id ?? redemption.reward_id ?? '').trim() || null;
  const rawAmount = redemption.amount ?? redemption.cost ?? rewardRec.cost ?? rewardRec.amount;
  const amount = Number.isFinite(Number(rawAmount)) ? Math.max(0, Math.floor(Number(rawAmount))) : 0;
  const rawEventId = String(redemption.id ?? data.id ?? root.id ?? '').trim();
  const providerEventId =
    rawEventId ||
    stableProviderEventId({
      provider: 'vkvideo',
      rawPayloadJson: JSON.stringify(pushData ?? {}),
      fallbackParts: [userId, rewardId ?? '', String(amount || 0)],
    });
  const eventAt = asDate(redemption.created_at ?? redemption.createdAt ?? data.created_at ?? data.createdAt ?? null);

  if (!userId || !providerEventId) return null;
  return { providerEventId, userId, rewardId, amount, eventAt };
}

export function handleVkvideoRewardPush(params: RewardPushParams): boolean {
  const parsed = parseChannelPointsEvent(params.pushData);
  if (!parsed) return false;

  void (async () => {
    try {
      if (!params.channelId) return;

      const channel = await prisma.channel.findUnique({
        where: { id: params.channelId },
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

      const rewardIdForCoins = String(channel.vkvideoRewardIdForCoins ?? '').trim() || null;
      if (!channel.vkvideoRewardEnabled) {
        await prisma.$transaction(async (tx) => {
          await recordExternalRewardEventTx({
            tx,
            provider: 'vkvideo',
            providerEventId: parsed.providerEventId,
            channelId: channel.id,
            providerAccountId: parsed.userId,
            eventType: 'vkvideo_channel_points_redemption',
            currency: 'vkvideo_channel_points',
            amount: parsed.amount,
            coinsToGrant: 0,
            status: 'ignored',
            reason: 'disabled',
            eventAt: parsed.eventAt,
            rawPayloadJson: JSON.stringify(params.pushData ?? {}),
          });
        });
        return;
      }

      if (rewardIdForCoins && parsed.rewardId && rewardIdForCoins !== parsed.rewardId) {
        await prisma.$transaction(async (tx) => {
          await recordExternalRewardEventTx({
            tx,
            provider: 'vkvideo',
            providerEventId: parsed.providerEventId,
            channelId: channel.id,
            providerAccountId: parsed.userId,
            eventType: 'vkvideo_channel_points_redemption',
            currency: 'vkvideo_channel_points',
            amount: parsed.amount,
            coinsToGrant: 0,
            status: 'ignored',
            reason: 'reward_mismatch',
            eventAt: parsed.eventAt,
            rawPayloadJson: JSON.stringify(params.pushData ?? {}),
          });
        });
        return;
      }

      const ratio = Number.isFinite(Number(channel.vkvideoCoinPerPointRatio))
        ? Math.max(0, Number(channel.vkvideoCoinPerPointRatio))
        : 1;
      const fixedCoins =
        channel.vkvideoRewardCoins !== null && channel.vkvideoRewardCoins !== undefined
          ? Number(channel.vkvideoRewardCoins)
          : null;
      const coinsToGrant = Number.isFinite(fixedCoins as number)
        ? Math.max(0, Math.floor(fixedCoins as number))
        : Math.max(0, Math.floor(parsed.amount * ratio));

      const shouldCheckLive = Boolean(channel.vkvideoRewardOnlyWhenLive);
      if (shouldCheckLive) {
        const slug = String(channel.slug || params.channelSlug || '').toLowerCase();
        const snap = await getStreamStatusSnapshot(slug);
        if (snap.status !== 'online') {
          await prisma.$transaction(async (tx) => {
            await recordExternalRewardEventTx({
              tx,
              provider: 'vkvideo',
              providerEventId: parsed.providerEventId,
              channelId: channel.id,
              providerAccountId: parsed.userId,
              eventType: 'vkvideo_channel_points_redemption',
              currency: 'vkvideo_channel_points',
              amount: parsed.amount,
              coinsToGrant: 0,
              status: 'ignored',
              reason: 'offline',
              eventAt: parsed.eventAt,
              rawPayloadJson: JSON.stringify(params.pushData ?? {}),
            });
          });
          return;
        }
      }

      if (coinsToGrant <= 0) {
        await prisma.$transaction(async (tx) => {
          await recordExternalRewardEventTx({
            tx,
            provider: 'vkvideo',
            providerEventId: parsed.providerEventId,
            channelId: channel.id,
            providerAccountId: parsed.userId,
            eventType: 'vkvideo_channel_points_redemption',
            currency: 'vkvideo_channel_points',
            amount: parsed.amount,
            coinsToGrant: 0,
            status: 'ignored',
            reason: 'zero_coins',
            eventAt: parsed.eventAt,
            rawPayloadJson: JSON.stringify(params.pushData ?? {}),
          });
        });
        return;
      }

      const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({
        provider: 'vkvideo',
        platformUserId: parsed.userId,
      });

      await prisma.$transaction(async (tx) => {
        await recordExternalRewardEventTx({
          tx,
          provider: 'vkvideo',
          providerEventId: parsed.providerEventId,
          channelId: channel.id,
          providerAccountId: parsed.userId,
          eventType: 'vkvideo_channel_points_redemption',
          currency: 'vkvideo_channel_points',
          amount: parsed.amount,
          coinsToGrant,
          status: 'eligible',
          reason: null,
          eventAt: parsed.eventAt,
          rawPayloadJson: JSON.stringify(params.pushData ?? {}),
        });

        if (linkedUserId) {
          await claimPendingCoinGrantsTx({
            tx,
            userId: linkedUserId,
            provider: 'vkvideo',
            providerAccountId: parsed.userId,
          });
        }
      });
    } catch (e: unknown) {
      logger.warn('vkvideo_reward_push_failed', { errorMessage: e instanceof Error ? e.message : String(e) });
    }
  })();

  return true;
}
