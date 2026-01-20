import type { Server } from 'socket.io';
import { prisma } from '../../lib/prisma.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer, type WalletUpdatedEvent } from '../../realtime/walletBridge.js';
import { claimPendingCoinGrantsTx, type PendingCoinGrantsTx } from '../../rewards/pendingCoinGrants.js';
import { recordExternalRewardEventTx, type ExternalRewardTx } from '../../rewards/externalRewardEvents.js';

export type RecordAndMaybeClaimParams = {
  channelId: string;
  providerEventId: string;
  providerAccountId: string;
  eventType:
    | 'twitch_follow'
    | 'twitch_subscribe'
    | 'twitch_resub_message'
    | 'twitch_gift_sub'
    | 'twitch_cheer'
    | 'twitch_raid'
    | 'twitch_channel_points_redemption'
    | 'twitch_chat_first_message'
    | 'twitch_chat_messages_threshold'
    | 'twitch_chat_daily_streak';
  currency: 'twitch_channel_points' | 'twitch_bits' | 'twitch_units';
  amount: number;
  coinsToGrant: number;
  status: 'observed' | 'eligible' | 'ignored' | 'failed';
  reason?: string | null;
  eventAt?: Date | null;
  linkedUserId?: string | null;
};

export async function recordAndMaybeClaim(
  rawBody: string,
  params: RecordAndMaybeClaimParams
): Promise<{ createdPending: boolean; claimedWalletEvents: WalletUpdatedEvent[] }> {
  const linkedUserId = String(params.linkedUserId || '').trim() || null;
  const claimedWalletEvents: WalletUpdatedEvent[] = [];
  const rec = await prisma.$transaction(async (tx) => {
    const created = await recordExternalRewardEventTx({
      tx: tx as unknown as ExternalRewardTx,
      provider: 'twitch',
      providerEventId: params.providerEventId,
      channelId: params.channelId,
      providerAccountId: params.providerAccountId,
      eventType: params.eventType,
      currency: params.currency,
      amount: params.amount,
      coinsToGrant: params.coinsToGrant,
      status: params.status,
      reason: params.reason ?? null,
      eventAt: params.eventAt ?? null,
      rawPayloadJson: rawBody,
    });

    if (linkedUserId && params.status === 'eligible' && params.coinsToGrant > 0) {
      const events = await claimPendingCoinGrantsTx({
        tx: tx as unknown as PendingCoinGrantsTx,
        userId: linkedUserId,
        provider: 'twitch',
        providerAccountId: params.providerAccountId,
      });
      if (events.length) claimedWalletEvents.push(...events);
    }

    return created;
  });

  return { createdPending: rec.createdPending, claimedWalletEvents };
}

export function emitWalletEvents(req: { app: { get: (key: string) => unknown } }, events: WalletUpdatedEvent[]): void {
  if (!events.length) return;
  try {
    const io = req.app.get('io') as Server | undefined;
    if (!io) return;
    for (const ev of events) {
      emitWalletUpdated(io, ev);
      void relayWalletUpdatedToPeer(ev);
    }
  } catch {
    // ignore
  }
}
