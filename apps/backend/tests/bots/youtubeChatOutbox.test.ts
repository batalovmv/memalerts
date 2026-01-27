import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  youTubeChatBotOutboxMessage: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
}));
const getValidYouTubeAccessTokenByExternalAccountId = vi.hoisted(() => vi.fn());
const getValidYouTubeBotAccessToken = vi.hoisted(() => vi.fn());
const fetchLiveVideoIdByChannelId = vi.hoisted(() => vi.fn());
const fetchActiveLiveChatIdByVideoId = vi.hoisted(() => vi.fn());
const sendToYouTubeChat = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));

vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/utils/youtubeApi.js', () => ({
  getValidYouTubeAccessTokenByExternalAccountId,
  getValidYouTubeBotAccessToken,
  fetchLiveVideoIdByChannelId,
  fetchActiveLiveChatIdByVideoId,
}));
vi.mock('../../src/bots/youtubeChatSender.js', () => ({ sendToYouTubeChat }));
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));

import { createYouTubeChatOutbox } from '../../src/bots/youtubeChatOutbox.js';
import type { YouTubeChannelState } from '../../src/bots/youtubeChatbotShared.js';

describe('youtube chat outbox', () => {
  const baseConfig = {
    outboxBullmqEnabled: false,
    outboxConcurrency: 1,
    outboxRateLimitMax: 20,
    outboxRateLimitWindowMs: 30_000,
    outboxChannelRateLimitMax: 5,
    outboxChannelRateLimitWindowMs: 10_000,
    outboxDedupWindowMs: 60_000,
    outboxLockTtlMs: 30_000,
    outboxLockDelayMs: 1_000,
    liveCheckSeconds: 20,
    stoppedRef: { value: false },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getValidYouTubeAccessTokenByExternalAccountId.mockReset();
    getValidYouTubeBotAccessToken.mockReset();
    fetchLiveVideoIdByChannelId.mockReset();
    fetchActiveLiveChatIdByVideoId.mockReset();
  });

  it('defers messages when no live chat is active', async () => {
    const st: YouTubeChannelState = {
      channelId: 'channel-1',
      userId: 'user-1',
      youtubeChannelId: 'yt-1',
      slug: 'slug-1',
      liveChatId: null,
      isLive: false,
      lastLiveCheckAt: 0,
      botExternalAccountId: null,
    };
    const states = new Map<string, YouTubeChannelState>([[st.channelId, st]]);

    prismaMock.youTubeChatBotOutboxMessage.findMany.mockResolvedValue([
      {
        id: 'outbox-1',
        channelId: 'channel-1',
        youtubeChannelId: 'yt-1',
        message: 'hi',
        status: 'pending',
        attempts: 0,
      },
    ]);

    const outbox = createYouTubeChatOutbox(states, baseConfig);
    await outbox.processOutboxOnce();

    expect(sendToYouTubeChat).not.toHaveBeenCalled();
    expect(prismaMock.youTubeChatBotOutboxMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1' },
        data: expect.objectContaining({ lastError: 'No active live chat' }),
      })
    );
  });

  it('sends messages when live chat is active', async () => {
    const st: YouTubeChannelState = {
      channelId: 'channel-1',
      userId: 'user-1',
      youtubeChannelId: 'yt-1',
      slug: 'slug-1',
      liveChatId: 'live-1',
      isLive: true,
      lastLiveCheckAt: 0,
      botExternalAccountId: null,
    };
    const states = new Map<string, YouTubeChannelState>([[st.channelId, st]]);

    prismaMock.youTubeChatBotOutboxMessage.findMany.mockResolvedValue([
      {
        id: 'outbox-2',
        channelId: 'channel-1',
        youtubeChannelId: 'yt-1',
        message: 'hello',
        status: 'pending',
        attempts: 0,
      },
    ]);
    prismaMock.youTubeChatBotOutboxMessage.updateMany.mockResolvedValue({ count: 1 });

    const outbox = createYouTubeChatOutbox(states, baseConfig);
    await outbox.processOutboxOnce();

    expect(sendToYouTubeChat).toHaveBeenCalledWith({ st, messageText: 'hello' });
    expect(prismaMock.youTubeChatBotOutboxMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-2' },
        data: expect.objectContaining({ status: 'sent' }),
      })
    );
  });
});
