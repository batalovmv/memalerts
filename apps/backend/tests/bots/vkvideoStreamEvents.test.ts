import { beforeEach, describe, expect, it, vi } from 'vitest';

const pubsubMocks = vi.hoisted(() => {
  type PubSubParams = { onPush: (payload: { channel: string; data: unknown }) => void };
  const instances: Array<{ params: PubSubParams; started: boolean; stopped: boolean }> = [];
  class FakePubSub {
    started = false;
    stopped = false;
    constructor(public params: PubSubParams) {
      instances.push(this);
    }
    start() {
      this.started = true;
    }
    stop() {
      this.stopped = true;
    }
    isOpen() {
      return false;
    }
  }
  return { instances, FakePubSub };
});

const prismaMock = vi.hoisted(() => ({
  vkVideoChatBotSubscription: { findMany: vi.fn(), update: vi.fn() },
  botIntegrationSettings: { findMany: vi.fn() },
}));
const getVkVideoExternalAccount = vi.hoisted(() => vi.fn());
const fetchVkVideoChannel = vi.hoisted(() => vi.fn());
const fetchVkVideoWebsocketToken = vi.hoisted(() => vi.fn());
const fetchVkVideoWebsocketSubscriptionTokens = vi.hoisted(() => vi.fn());
const fetchVkVideoCurrentUser = vi.hoisted(() => vi.fn());
const extractVkVideoChannelIdFromUrl = vi.hoisted(() => vi.fn());
const handleStreamOnline = vi.hoisted(() => vi.fn());
const handleStreamOffline = vi.hoisted(() => vi.fn());
const handleVkvideoRewardPush = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn() }));

vi.mock('../../src/bots/vkvideoPubsubClient.js', () => ({ VkVideoPubSubClient: pubsubMocks.FakePubSub }));
vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/utils/vkvideoApi.js', () => ({
  getVkVideoExternalAccount,
  fetchVkVideoChannel,
  fetchVkVideoWebsocketToken,
  fetchVkVideoWebsocketSubscriptionTokens,
  fetchVkVideoCurrentUser,
  extractVkVideoChannelIdFromUrl,
}));
vi.mock('../../src/realtime/streamStatusStore.js', () => ({ handleStreamOnline, handleStreamOffline }));
vi.mock('../../src/bots/vkvideoRewardProcessor.js', () => ({ handleVkvideoRewardPush }));
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));

import { createVkvideoStreamEvents } from '../../src/bots/vkvideoStreamEvents.js';

describe('vkvideo stream events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pubsubMocks.instances.length = 0;
    prismaMock.vkVideoChatBotSubscription.findMany.mockResolvedValue([
      {
        channelId: 'channel-1',
        userId: 'user-1',
        vkvideoChannelId: 'vk-1',
        vkvideoChannelUrl: 'https://vkvideo.example/channel/1',
        channel: { slug: 'slug-1' },
      },
    ]);
    prismaMock.botIntegrationSettings.findMany.mockResolvedValue([]);
    getVkVideoExternalAccount.mockResolvedValue({ accessToken: 'token-1' });
    fetchVkVideoChannel.mockResolvedValue({
      ok: true,
      streamId: 'stream-1',
      webSocketChannels: { chat: 'ws-chat' },
    });
    fetchVkVideoWebsocketToken.mockResolvedValue({ ok: true, token: 'ws-token' });
    fetchVkVideoWebsocketSubscriptionTokens.mockResolvedValue({
      tokensByChannel: new Map([['ws-chat', 'sub-token']]),
    });
    handleVkvideoRewardPush.mockReturnValue(false);
  });

  it('syncs subscriptions and forwards reward pushes', async () => {
    const state = {
      vkvideoIdToSlug: new Map(),
      vkvideoIdToChannelId: new Map(),
      vkvideoIdToOwnerUserId: new Map(),
      vkvideoIdToChannelUrl: new Map(),
      vkvideoIdToLastLiveStreamId: new Map(),
    };
    const pubsubState = {
      pubsubByChannelId: new Map(),
      pubsubCtxByChannelId: new Map(),
      wsChannelToVkvideoId: new Map(),
    };

    const events = createVkvideoStreamEvents(state, pubsubState, {
      pubsubWsUrl: 'wss://pubsub.example/ws',
      pubsubRefreshSeconds: 30,
      stoppedRef: { value: false },
    });

    await events.syncSubscriptions();

    expect(handleStreamOnline).toHaveBeenCalledWith('slug-1');
    expect(pubsubMocks.instances).toHaveLength(1);

    const instance = pubsubMocks.instances[0];
    const pushData = {
      type: 'channel_points',
      data: {
        redemption: {
          user: { id: 'u1', nick: 'Viewer' },
          amount: 10,
          reward: { id: 'reward-1' },
          id: 'red-1',
        },
      },
    };
    instance.params.onPush({
      channel: 'ws-chat',
      data: pushData,
    });

    expect(handleVkvideoRewardPush).toHaveBeenCalledWith({
      vkvideoChannelId: 'vk-1',
      channelId: 'channel-1',
      channelSlug: 'slug-1',
      pushData,
    });
  });
});
