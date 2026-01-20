import type { Response } from 'express';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  channel: {
    findUnique: vi.fn(),
  },
}));

const rewardsMock = vi.hoisted(() => ({
  recordAndMaybeClaim: vi.fn(),
  emitWalletEvents: vi.fn(),
}));

const streamMock = vi.hoisted(() => ({
  getStreamDurationSnapshot: vi.fn(),
}));

const chatIdentityMock = vi.hoisted(() => ({
  resolveMemalertsUserIdFromChatIdentity: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../src/controllers/webhook/twitchEventSubRewards.js', () => rewardsMock);
vi.mock('../src/realtime/streamDurationStore.js', () => streamMock);
vi.mock('../src/utils/chatIdentity.js', () => chatIdentityMock);

import { handleTwitchAutoRewardsEvent } from '../src/controllers/webhook/twitchEventSubAutoRewards.js';

type TestResponse = {
  statusCode: number;
  body?: unknown;
  status: (code: number) => TestResponse;
  json: (body: unknown) => TestResponse;
};

function makeRes(): TestResponse {
  const res: TestResponse = {
    statusCode: 200,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

function makeCtx(
  overrides: Partial<{
    subscriptionType: string;
    event: Record<string, unknown>;
  }> = {}
) {
  const res = makeRes();
  return {
    subscriptionType: overrides.subscriptionType || 'channel.subscribe',
    messageId: 'msg-1',
    messageTimestamp: new Date().toISOString(),
    rawBody: JSON.stringify(overrides.event || {}),
    req: {
      body: { event: overrides.event || {} },
      app: { get: () => undefined },
    },
    res: res as unknown as Response,
  };
}

const baseChannel = {
  id: 'channel-1',
  slug: 'channel-1',
};

beforeEach(() => {
  prismaMock.channel.findUnique.mockReset();
  rewardsMock.recordAndMaybeClaim.mockReset();
  rewardsMock.emitWalletEvents.mockReset();
  streamMock.getStreamDurationSnapshot.mockReset();
  chatIdentityMock.resolveMemalertsUserIdFromChatIdentity.mockReset();

  rewardsMock.recordAndMaybeClaim.mockResolvedValue({ createdPending: true, claimedWalletEvents: [] });
  chatIdentityMock.resolveMemalertsUserIdFromChatIdentity.mockResolvedValue('user-1');
  streamMock.getStreamDurationSnapshot.mockResolvedValue({ status: 'online', totalMinutes: 10, sessionId: 's1' });
});

describe('handleTwitchAutoRewardsEvent', () => {
  it('returns false for non-auto-reward events', async () => {
    const ctx = makeCtx({ subscriptionType: 'channel.unknown', event: {} });
    const handled = await handleTwitchAutoRewardsEvent(ctx);
    expect(handled).toBe(false);
    expect(rewardsMock.recordAndMaybeClaim).not.toHaveBeenCalled();
  });

  it('processes subscribe events', async () => {
    prismaMock.channel.findUnique.mockResolvedValue({
      ...baseChannel,
      twitchAutoRewardsJson: {
        v: 1,
        subscribe: { enabled: true, tierCoins: { '1000': 25 }, primeCoins: 10, onlyWhenLive: true },
      },
    });

    const ctx = makeCtx({
      subscriptionType: 'channel.subscribe',
      event: {
        broadcaster_user_id: 'tw-1',
        user_id: 'tw-user',
        user_name: 'Viewer',
        tier: '1000',
        is_prime: false,
      },
    });
    const handled = await handleTwitchAutoRewardsEvent(ctx);
    expect(handled).toBe(true);
    expect(rewardsMock.recordAndMaybeClaim).toHaveBeenCalledTimes(1);
  });

  it('processes resub message events', async () => {
    prismaMock.channel.findUnique.mockResolvedValue({
      ...baseChannel,
      twitchAutoRewardsJson: {
        v: 1,
        resubMessage: { enabled: true, tierCoins: { '1000': 15 }, bonusCoins: 5 },
      },
    });

    const ctx = makeCtx({
      subscriptionType: 'channel.subscription.message',
      event: {
        broadcaster_user_id: 'tw-1',
        user_id: 'tw-user',
        user_name: 'Viewer',
        tier: '1000',
        message: { text: 'hello' },
      },
    });
    const handled = await handleTwitchAutoRewardsEvent(ctx);
    expect(handled).toBe(true);
    expect(rewardsMock.recordAndMaybeClaim).toHaveBeenCalledTimes(1);
  });

  it('processes gift sub events for giver and recipient', async () => {
    prismaMock.channel.findUnique.mockResolvedValue({
      ...baseChannel,
      twitchAutoRewardsJson: {
        v: 1,
        giftSub: { enabled: true, giverTierCoins: { '1000': 5 }, recipientCoins: 3 },
      },
    });

    const ctx = makeCtx({
      subscriptionType: 'channel.subscription.gift',
      event: {
        broadcaster_user_id: 'tw-1',
        user_id: 'tw-giver',
        user_name: 'Giver',
        tier: '1000',
        total: 2,
        recipient_user_id: 'tw-recipient',
        recipient_user_name: 'Recipient',
      },
    });
    const handled = await handleTwitchAutoRewardsEvent(ctx);
    expect(handled).toBe(true);
    expect(rewardsMock.recordAndMaybeClaim).toHaveBeenCalledTimes(2);
  });

  it('processes cheer events', async () => {
    prismaMock.channel.findUnique.mockResolvedValue({
      ...baseChannel,
      twitchAutoRewardsJson: {
        v: 1,
        cheer: { enabled: true, bitsPerCoin: 100, minBits: 100 },
      },
    });

    const ctx = makeCtx({
      subscriptionType: 'channel.cheer',
      event: {
        broadcaster_user_id: 'tw-1',
        user_id: 'tw-cheer',
        user_name: 'Cheerer',
        bits: 500,
      },
    });
    const handled = await handleTwitchAutoRewardsEvent(ctx);
    expect(handled).toBe(true);
    expect(rewardsMock.recordAndMaybeClaim).toHaveBeenCalledTimes(1);
  });

  it('processes raid events', async () => {
    prismaMock.channel.findUnique.mockResolvedValue({
      ...baseChannel,
      twitchAutoRewardsJson: {
        v: 1,
        raid: { enabled: true, baseCoins: 10, coinsPerViewer: 1, minViewers: 2 },
      },
    });

    const ctx = makeCtx({
      subscriptionType: 'channel.raid',
      event: {
        from_broadcaster_user_id: 'tw-raider',
        from_broadcaster_user_name: 'Raider',
        to_broadcaster_user_id: 'tw-1',
        viewer_count: 5,
      },
    });
    const handled = await handleTwitchAutoRewardsEvent(ctx);
    expect(handled).toBe(true);
    expect(rewardsMock.recordAndMaybeClaim).toHaveBeenCalledTimes(1);
  });
});
