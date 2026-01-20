import type { Prisma } from '@prisma/client';
import type { Server } from 'socket.io';
import { prisma } from '../lib/prisma.js';
import { recordExternalRewardEventTx } from '../rewards/externalRewardEvents.js';
import { claimPendingCoinGrantsTx } from '../rewards/pendingCoinGrants.js';
import { resolveMemalertsUserIdFromChatIdentity } from '../utils/chatIdentity.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer } from '../realtime/walletBridge.js';
import type { WalletUpdatedEvent } from '../realtime/walletBridge.js';
import { TransactionEventBuffer } from '../utils/transactionEventBuffer.js';
import {
  type KickWebhookRequest,
  emptyWalletEvents,
  errCode,
  extractKickActorUserId,
  extractKickChannelId,
  extractKickCount,
  extractKickEventAt,
  extractKickKicksAmount,
  extractKickRecipientsUserIds,
  extractKickTier,
  parseAutoRewardsCfg,
} from './kickWebhookShared.js';
import {
  handleKickFollow,
  handleKickKicksGifted,
  handleKickLivestreamStatus,
  handleKickSubscriptionGifts,
  handleKickSubscriptionNew,
  handleKickSubscriptionRenewal,
} from './kickRewardAutoHandlers.js';

type TxClient = Prisma.TransactionClient;

type HandlerOutcome = { httpStatus: number; body: Record<string, unknown> };

export const AUTO_REWARD_EVENT_TYPES = new Set([
  'channel.followed',
  'channel.subscription.new',
  'channel.subscription.renewal',
  'channel.subscription.gifts',
  'kicks.gifted',
  'livestream.status.updated',
]);

export async function handleKickAutoRewardEvents(params: {
  req: KickWebhookRequest;
  payload: unknown;
  eventType: string;
  messageId: string;
}): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  const { req, payload, eventType, messageId } = params;
  const io = req.app?.get?.('io') as Server | undefined;
  const eventBuffer = new TransactionEventBuffer();
  let outcome!: { httpStatus: number; body: Record<string, unknown>; claimedWalletEvents: WalletUpdatedEvent[] };
  try {
    const kickChannelId = extractKickChannelId(payload);
    const actorId = extractKickActorUserId(payload);
    const recipients = extractKickRecipientsUserIds(payload);
    const total = extractKickCount(payload);
    const kicks = extractKickKicksAmount(payload);
    const tier = extractKickTier(payload);
    const eventAt = extractKickEventAt(payload);
    const rawPayloadJson = JSON.stringify(payload ?? {});

    outcome = await prisma.$transaction(async (tx: TxClient) => {
      const enqueueWalletEvents = (events: WalletUpdatedEvent[]) => {
        if (!io) return;
        if (!events.length) return;
        for (const ev of events) {
          eventBuffer.add(() => {
            emitWalletUpdated(io, ev);
            void relayWalletUpdatedToPeer(ev);
          });
        }
      };

      try {
        await tx.externalWebhookDeliveryDedup.create({
          data: {
            provider: 'kick',
            messageId,
          },
          select: { id: true },
        });
      } catch (e: unknown) {
        if (errCode(e) === 'P2002') {
          return {
            httpStatus: 200,
            body: { ok: true, duplicate: true },
            claimedWalletEvents: emptyWalletEvents<WalletUpdatedEvent>(),
          };
        }
        throw e;
      }

      if (!kickChannelId) {
        return {
          httpStatus: 200,
          body: { ok: true, ignored: true, reason: 'missing_channel_id' },
          claimedWalletEvents: emptyWalletEvents<WalletUpdatedEvent>(),
        };
      }

      const sub = await tx.kickChatBotSubscription.findFirst({
        where: { kickChannelId, enabled: true },
        orderBy: { createdAt: 'desc' },
        select: {
          channelId: true,
          channel: { select: { slug: true, twitchAutoRewardsJson: true, streamDurationCommandJson: true } },
        },
      });
      const channelId = String(sub?.channelId ?? '').trim();
      const slug = String(sub?.channel?.slug ?? '')
        .trim()
        .toLowerCase();
      const cfg = parseAutoRewardsCfg(sub?.channel?.twitchAutoRewardsJson);
      if (!channelId || !slug) {
        return {
          httpStatus: 200,
          body: { ok: true, ignored: true, reason: 'channel_not_mapped' },
          claimedWalletEvents: emptyWalletEvents<WalletUpdatedEvent>(),
        };
      }

      if (eventType === 'livestream.status.updated') {
        const response = await handleKickLivestreamStatus({
          payload,
          slug,
          streamDurationCommandJson: sub?.channel?.streamDurationCommandJson ?? null,
        });
        return { ...response, claimedWalletEvents: emptyWalletEvents<WalletUpdatedEvent>() };
      }

      const claimedWalletEvents: WalletUpdatedEvent[] = [];

      const recordAndMaybeClaimKick = async (recordParams: {
        providerEventId: string;
        providerAccountId: string;
        eventType:
          | 'twitch_follow'
          | 'twitch_subscribe'
          | 'twitch_resub_message'
          | 'twitch_gift_sub'
          | 'twitch_cheer'
          | 'twitch_raid'
          | 'twitch_chat_first_message'
          | 'twitch_chat_messages_threshold'
          | 'twitch_chat_daily_streak';
        currency: 'twitch_bits' | 'twitch_units';
        amount: number;
        coinsToGrant: number;
        status: 'observed' | 'eligible' | 'ignored' | 'failed';
        reason?: string | null;
      }) => {
        const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({
          provider: 'kick',
          platformUserId: recordParams.providerAccountId,
        });
        await recordExternalRewardEventTx({
          tx,
          provider: 'kick',
          providerEventId: recordParams.providerEventId,
          channelId,
          providerAccountId: recordParams.providerAccountId,
          eventType: recordParams.eventType,
          currency: recordParams.currency,
          amount: recordParams.amount,
          coinsToGrant: recordParams.coinsToGrant,
          status: recordParams.status,
          reason: recordParams.reason ?? null,
          eventAt,
          rawPayloadJson,
        });

        if (linkedUserId && recordParams.status === 'eligible' && recordParams.coinsToGrant > 0) {
          const events = await claimPendingCoinGrantsTx({
            tx,
            userId: linkedUserId,
            provider: 'kick',
            providerAccountId: recordParams.providerAccountId,
          });
          if (events.length) {
            claimedWalletEvents.push(...events);
            enqueueWalletEvents(events);
          }
        }
      };

      let response: HandlerOutcome | null = null;
      if (eventType === 'channel.followed') {
        response = await handleKickFollow({
          actorId,
          cfg,
          messageId,
          channelId,
          slug,
          record: recordAndMaybeClaimKick,
        });
      } else if (eventType === 'channel.subscription.new') {
        response = await handleKickSubscriptionNew({
          actorId,
          cfg,
          messageId,
          slug,
          tier,
          record: recordAndMaybeClaimKick,
        });
      } else if (eventType === 'channel.subscription.renewal') {
        response = await handleKickSubscriptionRenewal({
          actorId,
          cfg,
          messageId,
          slug,
          tier,
          record: recordAndMaybeClaimKick,
        });
      } else if (eventType === 'channel.subscription.gifts') {
        response = await handleKickSubscriptionGifts({
          actorId,
          recipients,
          total,
          cfg,
          messageId,
          slug,
          tier,
          record: recordAndMaybeClaimKick,
        });
      } else if (eventType === 'kicks.gifted') {
        response = await handleKickKicksGifted({
          actorId,
          kicks,
          cfg,
          messageId,
          slug,
          record: recordAndMaybeClaimKick,
        });
      }

      if (!response) {
        return {
          httpStatus: 200,
          body: { ok: true, ignored: true, reason: 'unhandled' },
          claimedWalletEvents: emptyWalletEvents<WalletUpdatedEvent>(),
        };
      }

      return { ...response, claimedWalletEvents };
    });
    eventBuffer.commit();
  } finally {
    await eventBuffer.flush();
  }

  return { httpStatus: outcome.httpStatus, body: outcome.body };
}
