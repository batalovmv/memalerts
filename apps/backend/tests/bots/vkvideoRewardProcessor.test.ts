import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({})),
  channel: { findUnique: vi.fn() },
}));
const getStreamDurationSnapshot = vi.hoisted(() => vi.fn());
const recordExternalRewardEventTx = vi.hoisted(() => vi.fn());
const stableProviderEventId = vi.hoisted(() => vi.fn().mockReturnValue('stable-id'));
const claimPendingCoinGrantsTx = vi.hoisted(() => vi.fn());
const resolveMemalertsUserIdFromChatIdentity = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/realtime/streamDurationStore.js', () => ({ getStreamDurationSnapshot }));
vi.mock('../../src/rewards/externalRewardEvents.js', () => ({ recordExternalRewardEventTx, stableProviderEventId }));
vi.mock('../../src/rewards/pendingCoinGrants.js', () => ({ claimPendingCoinGrantsTx }));
vi.mock('../../src/utils/chatIdentity.js', () => ({ resolveMemalertsUserIdFromChatIdentity }));
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));

import { handleVkvideoRewardPush } from '../../src/bots/vkvideoRewardProcessor.js';

describe('vkvideo reward processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records follow rewards when offline', async () => {
    getStreamDurationSnapshot.mockResolvedValue({ status: 'offline', totalMinutes: 0 });

    const handled = handleVkvideoRewardPush({
      vkvideoChannelId: 'vk-1',
      channelId: 'channel-1',
      channelSlug: 'slug-1',
      autoRewardsCfg: { follow: { enabled: true, coins: 5, onlyWhenLive: true, onceEver: true } },
      pushData: {
        type: 'follow',
        data: { event: { user: { id: 'u1' }, id: 'ev-1', created_at: '2025-01-01T00:00:00Z' } },
      },
    });

    expect(handled).toBe(true);
    await new Promise((r) => setTimeout(r, 0));

    expect(recordExternalRewardEventTx).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'vkvideo',
        eventType: 'twitch_follow',
        status: 'ignored',
        reason: 'offline',
      })
    );
  });

  it('records channel points redemptions with coins', async () => {
    prismaMock.channel.findUnique.mockResolvedValue({
      id: 'channel-1',
      slug: 'slug-1',
      vkvideoRewardEnabled: true,
      vkvideoRewardIdForCoins: null,
      vkvideoCoinPerPointRatio: 2,
      vkvideoRewardCoins: null,
      vkvideoRewardOnlyWhenLive: false,
    });
    resolveMemalertsUserIdFromChatIdentity.mockResolvedValue('mem-1');

    const handled = handleVkvideoRewardPush({
      vkvideoChannelId: 'vk-1',
      channelId: 'channel-1',
      channelSlug: 'slug-1',
      autoRewardsCfg: null,
      pushData: {
        type: 'channel_points',
        data: {
          redemption: {
            user: { id: 'u1' },
            amount: 10,
            reward: { id: 'reward-1' },
            id: 'red-1',
          },
        },
      },
    });

    expect(handled).toBe(true);
    await new Promise((r) => setTimeout(r, 0));

    expect(recordExternalRewardEventTx).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'vkvideo_channel_points_redemption',
        coinsToGrant: 20,
        status: 'eligible',
      })
    );
    expect(claimPendingCoinGrantsTx).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'mem-1', provider: 'vkvideo' })
    );
  });
});
