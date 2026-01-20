import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchActiveLiveChatIdByVideoId = vi.hoisted(() => vi.fn());
const fetchLiveVideoIdByChannelId = vi.hoisted(() => vi.fn());
const getValidYouTubeAccessToken = vi.hoisted(() => vi.fn());
const listLiveChatMessages = vi.hoisted(() => vi.fn());
const handleStreamOnline = vi.hoisted(() => vi.fn());
const handleStreamOffline = vi.hoisted(() => vi.fn());
const markCreditsSessionOffline = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));

vi.mock('../../src/utils/youtubeApi.js', () => ({
  fetchActiveLiveChatIdByVideoId,
  fetchLiveVideoIdByChannelId,
  getValidYouTubeAccessToken,
  listLiveChatMessages,
}));
vi.mock('../../src/realtime/streamDurationStore.js', () => ({ handleStreamOnline, handleStreamOffline }));
vi.mock('../../src/realtime/creditsSessionStore.js', () => ({ markCreditsSessionOffline }));
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));

import { createYouTubeChatPolling } from '../../src/bots/youtubeChatPolling.js';
import type { YouTubeChannelState } from '../../src/bots/youtubeChatbotShared.js';

describe('youtube chat polling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const buildState = (overrides: Partial<YouTubeChannelState> = {}): YouTubeChannelState => ({
    channelId: 'channel-1',
    userId: 'user-1',
    youtubeChannelId: 'yt-1',
    slug: 'slug-1',
    creditsReconnectWindowMinutes: 10,
    streamDurationCfg: {
      enabled: true,
      triggerNormalized: 'stream',
      responseTemplate: null,
      breakCreditMinutes: 15,
      onlyWhenLive: true,
    },
    liveChatId: null,
    isLive: false,
    firstPollAfterLive: false,
    pageToken: null,
    lastLiveCheckAt: 0,
    lastPollAt: 0,
    nextPollAtMs: undefined,
    pollInFlight: false,
    commandsTs: 0,
    commands: [],
    botExternalAccountId: null,
    ...overrides,
  });

  it('primes live chat and skips first poll items', async () => {
    const st = buildState();
    const states = new Map<string, YouTubeChannelState>([[st.channelId, st]]);
    const commands = { handleIncomingMessage: vi.fn() };

    getValidYouTubeAccessToken.mockResolvedValue('token');
    fetchLiveVideoIdByChannelId.mockResolvedValue('video-1');
    fetchActiveLiveChatIdByVideoId.mockResolvedValue('chat-1');
    listLiveChatMessages.mockResolvedValue({
      pollingIntervalMillis: 1500,
      nextPageToken: 'page-1',
      items: [{ id: 'msg-1' }],
    });

    const polling = createYouTubeChatPolling(states, commands, {
      liveCheckSeconds: 1,
      stoppedRef: { value: false },
    });

    await polling.pollChatsOnce();

    expect(st.isLive).toBe(true);
    expect(st.liveChatId).toBe('chat-1');
    expect(st.pageToken).toBe('page-1');
    expect(commands.handleIncomingMessage).not.toHaveBeenCalled();
    expect(handleStreamOnline).toHaveBeenCalledWith('slug-1', 15);
  });

  it('processes messages after the first poll', async () => {
    const st = buildState();
    const states = new Map<string, YouTubeChannelState>([[st.channelId, st]]);
    const commands = { handleIncomingMessage: vi.fn() };

    getValidYouTubeAccessToken.mockResolvedValue('token');
    fetchLiveVideoIdByChannelId.mockResolvedValue('video-1');
    fetchActiveLiveChatIdByVideoId.mockResolvedValue('chat-1');
    listLiveChatMessages
      .mockResolvedValueOnce({
        pollingIntervalMillis: 1500,
        nextPageToken: 'page-1',
        items: [{ id: 'msg-1' }],
      })
      .mockResolvedValueOnce({
        pollingIntervalMillis: 1500,
        nextPageToken: 'page-2',
        items: [{ id: 'msg-2' }, { id: 'msg-3' }],
      });

    const polling = createYouTubeChatPolling(states, commands, {
      liveCheckSeconds: 1,
      stoppedRef: { value: false },
    });

    await polling.pollChatsOnce();

    st.nextPollAtMs = Date.now() - 1;
    st.lastPollAt = Date.now() - 2000;

    await polling.pollChatsOnce();

    expect(commands.handleIncomingMessage).toHaveBeenCalledTimes(2);
  });

  it('marks streams offline when live chat disappears', async () => {
    const st = buildState({ isLive: true, liveChatId: 'chat-1', firstPollAfterLive: false });
    const states = new Map<string, YouTubeChannelState>([[st.channelId, st]]);
    const commands = { handleIncomingMessage: vi.fn() };

    getValidYouTubeAccessToken.mockResolvedValue('token');
    fetchLiveVideoIdByChannelId.mockResolvedValue(null);

    const polling = createYouTubeChatPolling(states, commands, {
      liveCheckSeconds: 1,
      stoppedRef: { value: false },
    });

    await polling.pollChatsOnce();

    expect(st.isLive).toBe(false);
    expect(st.liveChatId).toBeNull();
    expect(handleStreamOffline).toHaveBeenCalledWith('slug-1');
    expect(markCreditsSessionOffline).toHaveBeenCalledWith('slug-1', 10);
  });
});
