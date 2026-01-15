import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';
import type { WalletUpdatedEvent } from '../realtime/walletBridge.js';
import { WalletService } from './WalletService.js';

export type ExternalRewardTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export type PendingCoinGrantsTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function stableProviderEventId(params: {
  provider: string;
  rawPayloadJson: string;
  fallbackParts: string[];
}): string {
  const base = [params.provider, ...params.fallbackParts.map((p) => String(p || '').trim())].filter(Boolean).join('|');
  return sha256Hex(`${base}|${params.rawPayloadJson}`);
}

export async function recordExternalRewardEventTx(params: {
  tx: ExternalRewardTx;
  provider: 'kick' | 'trovo' | 'vkvideo' | 'twitch';
  providerEventId: string;
  channelId: string;
  providerAccountId: string;
  eventType:
    | 'kick_reward_redemption'
    | 'trovo_spell'
    | 'vkvideo_channel_points_redemption'
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
  currency:
    | 'kick_channel_points'
    | 'trovo_mana'
    | 'trovo_elixir'
    | 'vkvideo_channel_points'
    | 'twitch_channel_points'
    | 'twitch_bits'
    | 'twitch_units';
  amount: number;
  coinsToGrant: number;
  status: 'observed' | 'eligible' | 'ignored' | 'failed';
  reason?: string | null;
  eventAt?: Date | null;
  rawPayloadJson: string;
}): Promise<{ ok: boolean; externalEventId: string | null; createdPending: boolean }> {
  const channelId = String(params.channelId || '').trim();
  const providerAccountId = String(params.providerAccountId || '').trim();
  const providerEventId = String(params.providerEventId || '').trim();
  if (!channelId || !providerAccountId || !providerEventId)
    return { ok: false, externalEventId: null, createdPending: false };

  const amount = Number(params.amount ?? 0);
  const coinsToGrant = Number(params.coinsToGrant ?? 0);
  const safeAmount = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
  const safeCoins = Number.isFinite(coinsToGrant) && coinsToGrant > 0 ? Math.floor(coinsToGrant) : 0;

  // 1) Create (or get) event row (dedup by provider+providerEventId) without raising an error.
  // IMPORTANT: do not rely on catching P2002 inside a transaction; on Postgres it can abort the transaction (25P02).
  const upserted = await params.tx.externalRewardEvent.upsert({
    where: { provider_providerEventId: { provider: params.provider, providerEventId } },
    create: {
      provider: params.provider,
      providerEventId,
      channelId,
      providerAccountId,
      eventType: params.eventType,
      eventAt: params.eventAt ?? null,
      currency: params.currency,
      amount: safeAmount,
      status: params.status,
      reason: params.reason ?? null,
      rawPayloadJson: params.rawPayloadJson,
    },
    // Keep the first-seen payload/status as-is (append-only semantics). This is a deliberate no-op update.
    update: {},
    select: { id: true },
  });
  const externalEventId = String(upserted?.id || '') || null;

  if (!externalEventId) return { ok: false, externalEventId: null, createdPending: false };

  // 2) If eligible and coins > 0 => create pending grant (exactly-once by unique externalEventId).
  if (params.status === 'eligible' && safeCoins > 0) {
    const created = await params.tx.pendingCoinGrant.createMany({
      data: [
        {
          provider: params.provider,
          providerAccountId,
          channelId,
          externalEventId,
          coinsToGrant: safeCoins,
        },
      ],
      skipDuplicates: true,
    });
    return { ok: true, externalEventId, createdPending: (created?.count ?? 0) > 0 };
  }

  return { ok: true, externalEventId, createdPending: false };
}

export async function claimPendingCoinGrantsTx(params: {
  tx: PendingCoinGrantsTx;
  userId: string;
  provider: 'kick' | 'trovo' | 'vkvideo' | 'twitch';
  providerAccountId: string;
}): Promise<WalletUpdatedEvent[]> {
  const userId = String(params.userId || '').trim();
  const provider = params.provider;
  const providerAccountId = String(params.providerAccountId || '').trim();
  if (!userId || !providerAccountId) return [];

  // Find all unclaimed grants for this external identity.
  const pending = await params.tx.pendingCoinGrant.findMany({
    where: {
      provider,
      providerAccountId,
      claimedAt: null,
    },
    select: {
      id: true,
      channelId: true,
      coinsToGrant: true,
      externalEventId: true,
      externalEvent: { select: { id: true } },
      channel: { select: { slug: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 100, // safety
  });

  const out: WalletUpdatedEvent[] = [];
  for (const g of pending) {
    const channelId = String(g.channelId || '').trim();
    const delta = Number(g.coinsToGrant ?? 0);
    if (!channelId || !Number.isFinite(delta) || delta <= 0) continue;

    // Exactly-once: claim only if still unclaimed.
    const claimed = await params.tx.pendingCoinGrant.updateMany({
      where: { id: g.id, claimedAt: null },
      data: { claimedAt: new Date(), claimedByUserId: userId },
    });
    if (!claimed?.count) continue;

    const updatedWallet = await WalletService.incrementBalance(params.tx, { userId, channelId }, delta);

    // Best-effort: mark external event as claimed (useful for analytics/debugging).
    try {
      await params.tx.externalRewardEvent.update({
        where: { id: String(g.externalEvent?.id || g.externalEventId || '') },
        data: { status: 'claimed' },
        select: { id: true },
      });
    } catch {
      // ignore
    }

    out.push({
      userId,
      channelId,
      balance: Number(updatedWallet?.balance ?? 0),
      delta,
      reason: 'external_reward_claim',
      channelSlug: String(g.channel?.slug || '') || undefined,
    });
  }

  return out;
}

export type RewardService = {
  stableProviderEventId: typeof stableProviderEventId;
  recordExternalRewardEventTx: typeof recordExternalRewardEventTx;
  claimPendingCoinGrantsTx: typeof claimPendingCoinGrantsTx;
};

export const createRewardService = (): RewardService => ({
  stableProviderEventId,
  recordExternalRewardEventTx,
  claimPendingCoinGrantsTx,
});
