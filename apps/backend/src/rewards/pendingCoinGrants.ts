import type { PrismaClient } from '@prisma/client';
import type { WalletUpdatedEvent } from '../realtime/walletBridge.js';

type Tx = Omit<
  PrismaClient,
  // PrismaClient has many methods; for our use we only rely on model delegates + $queryRaw.
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export async function claimPendingCoinGrantsTx(params: {
  tx: Tx;
  userId: string;
  provider: 'kick' | 'trovo' | 'vkvideo';
  providerAccountId: string;
}): Promise<WalletUpdatedEvent[]> {
  const userId = String(params.userId || '').trim();
  const provider = params.provider;
  const providerAccountId = String(params.providerAccountId || '').trim();
  if (!userId || !providerAccountId) return [];

  // Find all unclaimed grants for this external identity.
  const pending = await (params.tx as any).pendingCoinGrant.findMany({
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
    const channelId = String((g as any)?.channelId || '').trim();
    const delta = Number((g as any)?.coinsToGrant ?? 0);
    if (!channelId || !Number.isFinite(delta) || delta <= 0) continue;

    // Exactly-once: claim only if still unclaimed.
    const claimed = await (params.tx as any).pendingCoinGrant.updateMany({
      where: { id: g.id, claimedAt: null },
      data: { claimedAt: new Date(), claimedByUserId: userId },
    });
    if (!claimed?.count) continue;

    const updatedWallet = await (params.tx as any).wallet.upsert({
      where: { userId_channelId: { userId, channelId } },
      create: { userId, channelId, balance: delta },
      update: { balance: { increment: delta } },
      select: { balance: true },
    });

    // Best-effort: mark external event as claimed (useful for analytics/debugging).
    try {
      await (params.tx as any).externalRewardEvent.update({
        where: { id: String((g as any)?.externalEvent?.id || (g as any)?.externalEventId || '') },
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
      channelSlug: String((g as any)?.channel?.slug || '') || undefined,
    });
  }

  return out;
}


