import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({})),
}));
const recordExternalRewardEventTx = vi.hoisted(() => vi.fn());
const stableProviderEventId = vi.hoisted(() => vi.fn().mockReturnValue('stable-id'));
const claimPendingCoinGrantsTx = vi.hoisted(() => vi.fn());
const getRedisClient = vi.hoisted(() => vi.fn());
const getRedisNamespace = vi.hoisted(() => vi.fn(() => 'test'));
const loggerMock = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/rewards/externalRewardEvents.js', () => ({ recordExternalRewardEventTx, stableProviderEventId }));
vi.mock('../../src/rewards/pendingCoinGrants.js', () => ({ claimPendingCoinGrantsTx }));
vi.mock('../../src/utils/redisClient.js', () => ({ getRedisClient, getRedisNamespace }));
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));

import { handleVkvideoChatAutoRewards } from '../../src/bots/vkvideoChatAutoRewards.js';

describe('vkvideo chat auto rewards', () => {
  const store = new Map<string, string>();
  const redisMock = {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string, opts?: { NX?: boolean }) => {
      if (opts?.NX && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    }),
    incr: vi.fn(async (k: string) => {
      const next = Number(store.get(k) || 0) + 1;
      store.set(k, String(next));
      return next;
    }),
    expire: vi.fn(async () => 1),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    getRedisClient.mockResolvedValue(redisMock);
  });

  it('awards daily streak, first message, and thresholds', async () => {
    const autoRewardsCfg = {
      chat: {
        dailyStreak: { enabled: true, coinsPerDay: 1 },
        firstMessage: { enabled: true, coins: 2, onlyWhenLive: true },
        messageThresholds: {
          enabled: true,
          thresholds: [2],
          coinsByThreshold: { 2: 3 },
          onlyWhenLive: true,
        },
      },
    };

    const baseParams = {
      channelId: 'channel-1',
      channelSlug: 'slug-1',
      vkvideoChannelId: 'vk-1',
      streamId: 'stream-1',
      incoming: {
        text: 'hello',
        userId: 'user-1',
        displayName: 'Viewer',
        senderLogin: 'viewer',
      },
      memalertsUserId: 'mem-1',
      autoRewardsCfg,
    };

    await handleVkvideoChatAutoRewards(baseParams);
    await handleVkvideoChatAutoRewards(baseParams);

    const events = recordExternalRewardEventTx.mock.calls.map((call) => call[0]?.eventType);
    expect(events).toContain('twitch_chat_daily_streak');
    expect(events).toContain('twitch_chat_first_message');
    expect(events).toContain('twitch_chat_messages_threshold');
    expect(claimPendingCoinGrantsTx).toHaveBeenCalled();
  });
});
