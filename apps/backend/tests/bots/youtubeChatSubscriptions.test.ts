import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  youTubeChatBotSubscription: { findMany: vi.fn() },
  botIntegrationSettings: { findMany: vi.fn() },
  youTubeBotIntegration: { findMany: vi.fn() },
}));
const getEntitledChannelIds = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/utils/entitlements.js', () => ({ getEntitledChannelIds }));

import { createYouTubeChatSubscriptions } from '../../src/bots/youtubeChatSubscriptions.js';
import type { YouTubeChannelState } from '../../src/bots/youtubeChatbotShared.js';

describe('youtube chat subscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('syncs subscriptions and parses stream duration config', async () => {
    prismaMock.youTubeChatBotSubscription.findMany.mockResolvedValue([
      {
        channelId: 'channel-1',
        userId: 'user-1',
        youtubeChannelId: 'yt-1',
        channel: {
          slug: 'Slug-1',
          creditsReconnectWindowMinutes: 5,
          streamDurationCommandJson: JSON.stringify({
            enabled: true,
            triggerNormalized: '!time',
            responseTemplate: 'Up {hours}h {minutes}m',
            breakCreditMinutes: 10,
            onlyWhenLive: false,
          }),
        },
      },
    ]);
    prismaMock.botIntegrationSettings.findMany.mockResolvedValue([]);
    prismaMock.youTubeBotIntegration.findMany.mockResolvedValue([
      { channelId: 'channel-1', externalAccountId: 'ext-yt' },
    ]);
    getEntitledChannelIds.mockResolvedValue(new Set(['channel-1']));

    const states = new Map<string, YouTubeChannelState>([
      [
        'remove-me',
        {
          channelId: 'remove-me',
          userId: 'user-old',
          youtubeChannelId: 'yt-old',
          slug: 'old',
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
        },
      ],
    ]);

    const subs = createYouTubeChatSubscriptions({ states, stoppedRef: { value: false } });
    await subs.syncSubscriptions();

    expect(states.has('remove-me')).toBe(false);
    const st = states.get('channel-1');
    expect(st?.slug).toBe('slug-1');
    expect(st?.creditsReconnectWindowMinutes).toBe(5);
    expect(st?.streamDurationCfg?.triggerNormalized).toBe('!time');
    expect(st?.botExternalAccountId).toBe('ext-yt');
  });
});
