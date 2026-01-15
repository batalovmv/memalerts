import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  youTubeChatBotOutboxMessage: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
}));
const sendToYouTubeChat = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));

vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
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
    outboxLockTtlMs: 30_000,
    outboxLockDelayMs: 1_000,
    stoppedRef: { value: false },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defers messages when no live chat is active', async () => {
    const st: YouTubeChannelState = {
      channelId: 'channel-1',
      userId: 'user-1',
      youtubeChannelId: 'yt-1',
      slug: 'slug-1',
      creditsReconnectWindowMinutes: 10,
      streamDurationCfg: null,
      liveChatId: null,
      isLive: false,
      firstPollAfterLive: false,
      pageToken: null,
      lastLiveCheckAt: 0,
      lastPollAt: 0,
      pollInFlight: false,
      commandsTs: 0,
      commands: [],
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
      creditsReconnectWindowMinutes: 10,
      streamDurationCfg: null,
      liveChatId: 'live-1',
      isLive: true,
      firstPollAfterLive: false,
      pageToken: null,
      lastLiveCheckAt: 0,
      lastPollAt: 0,
      pollInFlight: false,
      commandsTs: 0,
      commands: [],
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
