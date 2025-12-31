import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';

type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function stableProviderEventId(params: { provider: string; rawPayloadJson: string; fallbackParts: string[] }): string {
  const base = [params.provider, ...params.fallbackParts.map((p) => String(p || '').trim())].filter(Boolean).join('|');
  return sha256Hex(`${base}|${params.rawPayloadJson}`);
}

export async function recordExternalRewardEventTx(params: {
  tx: Tx;
  provider: 'kick' | 'trovo' | 'vkvideo';
  providerEventId: string;
  channelId: string;
  providerAccountId: string;
  eventType: 'kick_reward_redemption' | 'trovo_spell' | 'vkvideo_channel_points_redemption';
  currency: 'kick_channel_points' | 'trovo_mana' | 'trovo_elixir' | 'vkvideo_channel_points';
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
  if (!channelId || !providerAccountId || !providerEventId) return { ok: false, externalEventId: null, createdPending: false };

  const amount = Number(params.amount ?? 0);
  const coinsToGrant = Number(params.coinsToGrant ?? 0);
  const safeAmount = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
  const safeCoins = Number.isFinite(coinsToGrant) && coinsToGrant > 0 ? Math.floor(coinsToGrant) : 0;

  // 1) Create (or get) event row (dedup by provider+providerEventId) without raising an error.
  // IMPORTANT: do not rely on catching P2002 inside a transaction; on Postgres it can abort the transaction (25P02).
  const upserted = await (params.tx as any).externalRewardEvent.upsert({
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
    const created = await (params.tx as any).pendingCoinGrant.createMany({
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


