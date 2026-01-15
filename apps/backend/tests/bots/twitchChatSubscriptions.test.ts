import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  chatBotSubscription: { findMany: vi.fn() },
  botIntegrationSettings: { findMany: vi.fn() },
  twitchBotIntegration: { findMany: vi.fn() },
}));
const getEntitledChannelIds = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn() }));

vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/utils/entitlements.js', () => ({ getEntitledChannelIds }));
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));

import { createTwitchChatSubscriptions } from '../../src/bots/twitchChatSubscriptions.js';

describe('twitch chat subscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('syncs subscriptions and joins/parts channels', async () => {
    prismaMock.chatBotSubscription.findMany.mockResolvedValue([
      {
        channelId: 'channel-1',
        twitchLogin: 'Streamer',
        channel: { slug: 'slug-1' },
      },
      {
        channelId: 'channel-2',
        twitchLogin: 'old',
        channel: { slug: 'slug-2' },
      },
    ]);
    prismaMock.botIntegrationSettings.findMany.mockResolvedValue([
      { channelId: 'channel-1', enabled: true },
      { channelId: 'channel-2', enabled: false },
    ]);
    prismaMock.twitchBotIntegration.findMany.mockResolvedValue([
      { channelId: 'channel-1', externalAccountId: 'ext-1' },
    ]);
    getEntitledChannelIds.mockResolvedValue(new Set(['channel-1']));

    const loginToSlug = new Map<string, string>();
    const loginToChannelId = new Map<string, string>();
    const channelIdToOverrideExtId = new Map<string, string>();
    const joinedDefault = new Set<string>(['old']);
    const refreshCommands = vi.fn().mockResolvedValue(undefined);
    const defaultClientRef = {
      value: {
        client: {
          join: vi.fn().mockResolvedValue(undefined),
          part: vi.fn().mockResolvedValue(undefined),
        },
      },
    };

    const subs = createTwitchChatSubscriptions({
      defaultClientRef,
      joinedDefault,
      loginToSlug,
      loginToChannelId,
      channelIdToOverrideExtId,
      stoppedRef: { value: false },
      refreshCommands,
    });

    await subs.syncSubscriptions();

    expect(loginToSlug.get('streamer')).toBe('slug-1');
    expect(loginToChannelId.get('streamer')).toBe('channel-1');
    expect(channelIdToOverrideExtId.get('channel-1')).toBe('ext-1');
    expect(defaultClientRef.value.client.join).toHaveBeenCalledWith('streamer');
    expect(defaultClientRef.value.client.part).toHaveBeenCalledWith('old');
  });
});
