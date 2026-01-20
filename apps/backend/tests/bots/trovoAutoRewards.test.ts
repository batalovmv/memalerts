import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({})),
  channel: { findUnique: vi.fn() },
}));
const getStreamDurationSnapshot = vi.hoisted(() => vi.fn());
const getStreamSessionSnapshot = vi.hoisted(() => vi.fn());
const recordExternalRewardEventTx = vi.hoisted(() => vi.fn());
const stableProviderEventId = vi.hoisted(() => vi.fn().mockReturnValue('stable-id'));
const claimPendingCoinGrantsTx = vi.hoisted(() => vi.fn());
const resolveMemalertsUserIdFromChatIdentity = vi.hoisted(() => vi.fn());
const getRedisClient = vi.hoisted(() => vi.fn());
const getRedisNamespace = vi.hoisted(() => vi.fn(() => 'test'));
const loggerMock = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/realtime/streamDurationStore.js', () => ({ getStreamDurationSnapshot, getStreamSessionSnapshot }));
vi.mock('../../src/rewards/externalRewardEvents.js', () => ({ recordExternalRewardEventTx, stableProviderEventId }));
vi.mock('../../src/rewards/pendingCoinGrants.js', () => ({ claimPendingCoinGrantsTx }));
vi.mock('../../src/utils/chatIdentity.js', () => ({ resolveMemalertsUserIdFromChatIdentity }));
vi.mock('../../src/utils/redisClient.js', () => ({ getRedisClient, getRedisNamespace }));
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));

import { createTrovoAutoRewards } from '../../src/bots/trovoAutoRewards.js';
import type { TrovoChannelState } from '../../src/bots/trovoChatbotShared.js';

describe('trovo auto rewards', () => {
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

  const baseState: TrovoChannelState = {
    channelId: 'channel-1',
    userId: 'user-1',
    trovoChannelId: 'trovo-1',
    slug: 'slug-1',
    ws: null,
    wsToken: null,
    wsConnected: false,
    wsAuthNonce: null,
    wsPingTimer: null,
    wsPingGapSeconds: 0,
    lastConnectAt: 0,
    botExternalAccountId: null,
    commandsTs: 0,
    commands: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    getRedisClient.mockResolvedValue(redisMock);
    resolveMemalertsUserIdFromChatIdentity.mockResolvedValue('mem-1');
  });

  it('records follow rewards as ignored when offline', async () => {
    prismaMock.channel.findUnique.mockResolvedValue({
      twitchAutoRewardsJson: { follow: { enabled: true, coins: 5, onlyWhenLive: true, onceEver: true } },
    });
    getStreamDurationSnapshot.mockResolvedValue({ status: 'offline', totalMinutes: 0 });

    const autoRewards = createTrovoAutoRewards();
    await autoRewards.handleAutoRewards({
      st: baseState,
      envelope: { data: { eid: 'ev-1' } },
      chat: { type: 5003, uid: 'trovo-user', send_time: 1_700_000_000 },
    });

    expect(recordExternalRewardEventTx).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'twitch_follow', status: 'ignored', reason: 'offline' })
    );
  });

  it('awards chat streaks, first message, and thresholds', async () => {
    prismaMock.channel.findUnique.mockResolvedValue({
      twitchAutoRewardsJson: {
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
      },
    });
    getStreamSessionSnapshot.mockResolvedValue({ status: 'online', totalMinutes: 10, sessionId: 'sid-1' });

    const autoRewards = createTrovoAutoRewards();
    const params = {
      st: baseState,
      envelope: { data: { eid: 'ev-2' } },
      chat: { type: 0, uid: 'trovo-user', content: 'hello', send_time: 1_700_000_000 },
    };

    await autoRewards.handleAutoRewards(params);
    await autoRewards.handleAutoRewards(params);

    const events = recordExternalRewardEventTx.mock.calls.map((call) => call[0]?.eventType);
    expect(events).toContain('twitch_chat_daily_streak');
    expect(events).toContain('twitch_chat_first_message');
    expect(events).toContain('twitch_chat_messages_threshold');
    expect(claimPendingCoinGrantsTx).toHaveBeenCalled();
  });
});
