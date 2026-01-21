import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  chatBotCommand: { findMany: vi.fn() },
}));
const getStreamDurationSnapshot = vi.hoisted(() => vi.fn());
const resolveMemalertsUserIdFromChatIdentity = vi.hoisted(() => vi.fn());
const sendToYouTubeChat = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));

vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/realtime/streamDurationStore.js', () => ({ getStreamDurationSnapshot }));
vi.mock('../../src/utils/chatIdentity.js', () => ({ resolveMemalertsUserIdFromChatIdentity }));
vi.mock('../../src/bots/youtubeChatSender.js', () => ({ sendToYouTubeChat }));
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));

import { createYouTubeChatCommands } from '../../src/bots/youtubeChatCommands.js';
import type { YouTubeChannelState } from '../../src/bots/youtubeChatbotShared.js';

describe('youtube chat commands', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('replies with stream duration and posts credits chatter', async () => {
    resolveMemalertsUserIdFromChatIdentity.mockResolvedValue('mem-1');
    getStreamDurationSnapshot.mockResolvedValue({ status: 'online', totalMinutes: 125 });

    const st: YouTubeChannelState = {
      channelId: 'channel-1',
      userId: 'user-1',
      youtubeChannelId: 'yt-1',
      slug: 'slug-1',
      creditsReconnectWindowMinutes: 10,
      streamDurationCfg: {
        enabled: true,
        triggerNormalized: 'uptime',
        responseTemplate: 'Up {hours}h {minutes}m ({totalMinutes}m)',
        breakCreditMinutes: 10,
        onlyWhenLive: false,
      },
      liveChatId: 'live-1',
      isLive: true,
      firstPollAfterLive: false,
      pageToken: null,
      lastLiveCheckAt: 0,
      lastPollAt: 0,
      pollInFlight: false,
      commandsTs: Date.now(),
      commands: [],
      botExternalAccountId: null,
    };
    const states = new Map<string, YouTubeChannelState>([[st.channelId, st]]);
    const commands = createYouTubeChatCommands(states, {
      backendBaseUrls: ['https://base.test'],
      commandsRefreshSeconds: 30,
      stoppedRef: { value: false },
    });

    await commands.handleIncomingMessage(st, {
      authorDetails: { displayName: 'Viewer', channelId: 'yt-user', isChatModerator: true },
      snippet: { displayMessage: 'uptime' },
    });

    expect(sendToYouTubeChat).toHaveBeenCalledWith({ st, messageText: 'Up 2h 5m (125m)' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://base.test/internal/credits/chatter',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('refreshes commands and replies when roles match', async () => {
    resolveMemalertsUserIdFromChatIdentity.mockResolvedValue(null);
    prismaMock.chatBotCommand.findMany.mockResolvedValue([
      {
        triggerNormalized: 'PING',
        response: 'pong',
        onlyWhenLive: false,
        requiredRoleTags: ['MODERATOR'],
        roleMode: 'ANY',
      },
    ]);

    const st: YouTubeChannelState = {
      channelId: 'channel-1',
      userId: 'user-1',
      youtubeChannelId: 'yt-1',
      slug: 'slug-1',
      creditsReconnectWindowMinutes: 10,
      streamDurationCfg: null,
      liveChatId: 'live-1',
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
    const commands = createYouTubeChatCommands(states, {
      backendBaseUrls: ['https://base.test'],
      commandsRefreshSeconds: 1,
      stoppedRef: { value: false },
    });

    await commands.handleIncomingMessage(st, {
      authorDetails: { displayName: 'Mod', channelId: 'yt-mod', isChatModerator: true },
      snippet: { displayMessage: 'ping' },
    });

    expect(prismaMock.chatBotCommand.findMany).toHaveBeenCalled();
    expect(sendToYouTubeChat).toHaveBeenCalledWith({ st, messageText: 'pong' });
  });
});
