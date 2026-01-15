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
vi.mock('../../src/realtime/streamDurationStore.js', () => ({ handleStreamOnline, handleStreamOffline }));
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
        channel: { slug: 'slug-1', creditsReconnectWindowMinutes: 10, streamDurationCommandJson: null },
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

  it('syncs subscriptions and forwards chat messages', async () => {
    const state = {
      vkvideoIdToSlug: new Map(),
      vkvideoIdToChannelId: new Map(),
      vkvideoIdToOwnerUserId: new Map(),
      vkvideoIdToChannelUrl: new Map(),
      vkvideoIdToLastLiveStreamId: new Map(),
      streamDurationCfgByChannelId: new Map([['channel-1', { ts: Date.now(), cfg: { breakCreditMinutes: 15 } }]]),
      autoRewardsByChannelId: new Map([['channel-1', { ts: Date.now(), cfg: null }]]),
    };
    const pubsubState = {
      pubsubByChannelId: new Map(),
      pubsubCtxByChannelId: new Map(),
      wsChannelToVkvideoId: new Map(),
    };
    const handleIncoming = vi.fn();

    const events = createVkvideoStreamEvents(
      state,
      pubsubState,
      { pubsubWsUrl: 'wss://pubsub.example/ws', pubsubRefreshSeconds: 30, stoppedRef: { value: false } },
      { handleIncoming }
    );

    await events.syncSubscriptions();

    expect(handleStreamOnline).toHaveBeenCalledWith('slug-1', 15);
    expect(pubsubMocks.instances).toHaveLength(1);

    const instance = pubsubMocks.instances[0];
    instance.params.onPush({
      channel: 'ws-chat',
      data: {
        data: {
          message: {
            author: { id: 'u1', nick: 'Viewer' },
            parts: [{ text: { content: 'hello' } }],
          },
        },
      },
    });

    expect(handleIncoming).toHaveBeenCalledWith(
      'vk-1',
      expect.objectContaining({ userId: 'u1', displayName: 'Viewer', text: 'hello' })
    );
  });
});
