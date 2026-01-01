import { prisma } from '../src/lib/prisma.js';
import { claimPendingCoinGrantsTx } from '../src/rewards/pendingCoinGrants.js';
import { recordExternalRewardEventTx } from '../src/rewards/externalRewardEvents.js';

function rand(): string {
  return Math.random().toString(16).slice(2);
}

describe('external rewards -> pending coin grants -> claim on account link', () => {
  it('records a pending grant (dedup) and claims exactly-once into the wallet', async () => {
    const channel = await prisma.channel.create({
      data: {
        slug: `ch_${rand()}`,
        name: `Channel ${rand()}`,
      },
      select: { id: true, slug: true },
    });

    const user = await prisma.user.create({
      data: { displayName: `User ${rand()}`, role: 'viewer', hasBetaAccess: false },
      select: { id: true },
    });

    const providerAccountId = `kick_user_${rand()}`;
    const providerEventId = `kick_evt_${rand()}`;

    // Create the same event twice -> should dedup and create at most one pending grant.
    await prisma.$transaction(async (tx) => {
      const r1 = await recordExternalRewardEventTx({
        tx: tx as any,
        provider: 'kick',
        providerEventId,
        channelId: channel.id,
        providerAccountId,
        eventType: 'kick_reward_redemption',
        currency: 'kick_channel_points',
        amount: 100,
        coinsToGrant: 250,
        status: 'eligible',
        reason: null,
        eventAt: new Date(),
        rawPayloadJson: JSON.stringify({ id: providerEventId }),
      });
      expect(r1.ok).toBe(true);

      const r2 = await recordExternalRewardEventTx({
        tx: tx as any,
        provider: 'kick',
        providerEventId,
        channelId: channel.id,
        providerAccountId,
        eventType: 'kick_reward_redemption',
        currency: 'kick_channel_points',
        amount: 100,
        coinsToGrant: 250,
        status: 'eligible',
        reason: null,
        eventAt: new Date(),
        rawPayloadJson: JSON.stringify({ id: providerEventId, retry: true }),
      });
      expect(r2.ok).toBe(true);
    });

    const pendingCount = await (prisma as any).pendingCoinGrant.count({
      where: { provider: 'kick', providerAccountId, channelId: channel.id },
    });
    expect(pendingCount).toBe(1);

    // Claim: should increment wallet and mark pending as claimed.
    const events1 = await prisma.$transaction(async (tx) => {
      return await claimPendingCoinGrantsTx({ tx: tx as any, userId: user.id, provider: 'kick', providerAccountId });
    });
    expect(events1).toHaveLength(1);
    expect(events1[0].userId).toBe(user.id);
    expect(events1[0].channelId).toBe(channel.id);
    expect(events1[0].delta).toBe(250);
    expect(events1[0].balance).toBe(250);

    const wallet = await prisma.wallet.findUnique({
      where: { userId_channelId: { userId: user.id, channelId: channel.id } },
    });
    expect(wallet?.balance).toBe(250);

    const pending = await (prisma as any).pendingCoinGrant.findFirst({
      where: { provider: 'kick', providerAccountId, channelId: channel.id },
      select: { claimedAt: true, claimedByUserId: true },
    });
    expect(pending?.claimedByUserId).toBe(user.id);
    expect(pending?.claimedAt).not.toBeNull();

    // Claim again: must be exactly-once (no new wallet delta).
    const events2 = await prisma.$transaction(async (tx) => {
      return await claimPendingCoinGrantsTx({ tx: tx as any, userId: user.id, provider: 'kick', providerAccountId });
    });
    expect(events2).toHaveLength(0);

    const wallet2 = await prisma.wallet.findUnique({
      where: { userId_channelId: { userId: user.id, channelId: channel.id } },
    });
    expect(wallet2?.balance).toBe(250);
  });

  it('supports non-native eventType mapping for trovo (e.g. follow uses twitch_* eventType)', async () => {
    const channel = await prisma.channel.create({
      data: {
        slug: `ch_${rand()}`,
        name: `Channel ${rand()}`,
      },
      select: { id: true },
    });

    const user = await prisma.user.create({
      data: { displayName: `User ${rand()}`, role: 'viewer', hasBetaAccess: false },
      select: { id: true },
    });

    const providerAccountId = `trovo_user_${rand()}`;
    const providerEventId = `trovo_evt_${rand()}`;

    await prisma.$transaction(async (tx) => {
      await recordExternalRewardEventTx({
        tx: tx as any,
        provider: 'trovo',
        providerEventId,
        channelId: channel.id,
        providerAccountId,
        eventType: 'twitch_follow',
        currency: 'twitch_units',
        amount: 1,
        coinsToGrant: 77,
        status: 'eligible',
        reason: null,
        eventAt: new Date(),
        rawPayloadJson: JSON.stringify({ id: providerEventId }),
      });
    });

    const pendingCount = await (prisma as any).pendingCoinGrant.count({
      where: { provider: 'trovo', providerAccountId, channelId: channel.id },
    });
    expect(pendingCount).toBe(1);

    const events1 = await prisma.$transaction(async (tx) => {
      return await claimPendingCoinGrantsTx({ tx: tx as any, userId: user.id, provider: 'trovo', providerAccountId });
    });
    expect(events1).toHaveLength(1);
    expect(events1[0].delta).toBe(77);
  });
});


