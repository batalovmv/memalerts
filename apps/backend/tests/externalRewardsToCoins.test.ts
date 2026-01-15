import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { claimPendingCoinGrantsTx } from '../src/rewards/pendingCoinGrants.js';
import { recordExternalRewardEventTx } from '../src/rewards/externalRewardEvents.js';
import { createChannel, createUser } from './factories/index.js';

function rand(): string {
  return Math.random().toString(16).slice(2);
}

describe('external rewards -> pending coin grants -> claim on account link', () => {
  it('records a pending grant (dedup) and claims exactly-once into the wallet', async () => {
    const channel = await createChannel({
      slug: `ch_${rand()}`,
      name: `Channel ${rand()}`,
    });

    const user = await createUser({ displayName: `User ${rand()}`, role: 'viewer', hasBetaAccess: false });

    const providerAccountId = `kick_user_${rand()}`;
    const providerEventId = `kick_evt_${rand()}`;

    // Create the same event twice -> should dedup and create at most one pending grant.
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const r1 = await recordExternalRewardEventTx({
        tx,
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
        tx,
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

    const pendingCount = await prisma.pendingCoinGrant.count({
      where: { provider: 'kick', providerAccountId, channelId: channel.id },
    });
    expect(pendingCount).toBe(1);

    // Claim: should increment wallet and mark pending as claimed.
    const events1 = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      return await claimPendingCoinGrantsTx({ tx, userId: user.id, provider: 'kick', providerAccountId });
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

    const pending = await prisma.pendingCoinGrant.findFirst({
      where: { provider: 'kick', providerAccountId, channelId: channel.id },
      select: { claimedAt: true, claimedByUserId: true },
    });
    expect(pending?.claimedByUserId).toBe(user.id);
    expect(pending?.claimedAt).not.toBeNull();

    // Claim again: must be exactly-once (no new wallet delta).
    const events2 = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      return await claimPendingCoinGrantsTx({ tx, userId: user.id, provider: 'kick', providerAccountId });
    });
    expect(events2).toHaveLength(0);

    const wallet2 = await prisma.wallet.findUnique({
      where: { userId_channelId: { userId: user.id, channelId: channel.id } },
    });
    expect(wallet2?.balance).toBe(250);
  });

  it('supports non-native eventType mapping for trovo (e.g. follow uses twitch_* eventType)', async () => {
    const channel = await createChannel({
      slug: `ch_${rand()}`,
      name: `Channel ${rand()}`,
    });

    const user = await createUser({ displayName: `User ${rand()}`, role: 'viewer', hasBetaAccess: false });

    const providerAccountId = `trovo_user_${rand()}`;
    const providerEventId = `trovo_evt_${rand()}`;

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await recordExternalRewardEventTx({
        tx,
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

    const pendingCount = await prisma.pendingCoinGrant.count({
      where: { provider: 'trovo', providerAccountId, channelId: channel.id },
    });
    expect(pendingCount).toBe(1);

    const events1 = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      return await claimPendingCoinGrantsTx({ tx, userId: user.id, provider: 'trovo', providerAccountId });
    });
    expect(events1).toHaveLength(1);
    expect(events1[0].delta).toBe(77);
  });
});
