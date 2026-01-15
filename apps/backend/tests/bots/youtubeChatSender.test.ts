import { describe, expect, it, vi } from 'vitest';

const getValidYouTubeAccessTokenByExternalAccountId = vi.hoisted(() => vi.fn());
const getValidYouTubeBotAccessToken = vi.hoisted(() => vi.fn());
const sendLiveChatMessage = vi.hoisted(() => vi.fn());

vi.mock('../../src/utils/youtubeApi.js', () => ({
  getValidYouTubeAccessTokenByExternalAccountId,
  getValidYouTubeBotAccessToken,
  sendLiveChatMessage,
}));

import { sendToYouTubeChat } from '../../src/bots/youtubeChatSender.js';
import type { YouTubeChannelState } from '../../src/bots/youtubeChatbotShared.js';

describe('youtube chat sender', () => {
  it('throws when no live chat is active', async () => {
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

    await expect(sendToYouTubeChat({ st, messageText: 'hello' })).rejects.toThrow('No active live chat');
  });

  it('sends messages with bot token', async () => {
    getValidYouTubeBotAccessToken.mockResolvedValue('yt-token');
    sendLiveChatMessage.mockResolvedValue(undefined);

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

    await sendToYouTubeChat({ st, messageText: 'hello' });

    expect(sendLiveChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'yt-token', liveChatId: 'live-1', messageText: 'hello' })
    );
  });
});
