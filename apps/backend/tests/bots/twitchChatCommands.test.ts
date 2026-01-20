import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  chatBotCommand: { findMany: vi.fn() },
  channel: { findMany: vi.fn() },
}));
const getStreamDurationSnapshot = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/realtime/streamDurationStore.js', () => ({ getStreamDurationSnapshot }));
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));

import { createTwitchChatCommands, type TwitchChatCommandState } from '../../src/bots/twitchChatCommands.js';

describe('twitch chat commands', () => {
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

  it('refreshes commands and stream duration config', async () => {
    const state: TwitchChatCommandState = {
      loginToSlug: new Map([['streamer', 'slug-1']]),
      loginToChannelId: new Map([['streamer', 'channel-1']]),
      commandsByChannelId: new Map(),
      streamDurationByChannelId: new Map(),
    };

    prismaMock.chatBotCommand.findMany.mockResolvedValue([
      {
        channelId: 'channel-1',
        triggerNormalized: ' Hello ',
        response: 'Hi',
        onlyWhenLive: false,
        allowedRoles: ['moderator'],
        allowedUsers: ['@Mod'],
      },
    ]);
    prismaMock.channel.findMany.mockResolvedValue([
      {
        id: 'channel-1',
        streamDurationCommandJson: JSON.stringify({
          enabled: true,
          triggerNormalized: '!time',
          responseTemplate: null,
          breakCreditMinutes: 15,
          onlyWhenLive: false,
        }),
      },
    ]);

    const commands = createTwitchChatCommands(state, {
      backendBaseUrls: [],
      commandsRefreshSeconds: 30,
      stoppedRef: { value: false },
      sayForChannel: vi.fn(),
    });

    await commands.refreshCommands();

    const items = state.commandsByChannelId.get('channel-1')?.items || [];
    expect(items[0]).toEqual(
      expect.objectContaining({
        triggerNormalized: 'hello',
        response: 'Hi',
        allowedUsers: ['mod'],
        allowedRoles: ['moderator'],
      })
    );
    expect(state.streamDurationByChannelId.get('channel-1')?.cfg?.triggerNormalized).toBe('!time');
  });

  it('sends stream duration reply and posts credits chatter', async () => {
    const state: TwitchChatCommandState = {
      loginToSlug: new Map([['streamer', 'slug-1']]),
      loginToChannelId: new Map([['streamer', 'channel-1']]),
      commandsByChannelId: new Map([['channel-1', { ts: Date.now(), items: [] }]]),
      streamDurationByChannelId: new Map([
        [
          'channel-1',
          {
            ts: Date.now(),
            cfg: {
              enabled: true,
              triggerNormalized: '!time',
              responseTemplate: 'Up {hours}h {minutes}m',
              breakCreditMinutes: 10,
              onlyWhenLive: false,
            },
          },
        ],
      ]),
    };

    getStreamDurationSnapshot.mockResolvedValue({ status: 'online', totalMinutes: 61 });

    const sayForChannel = vi.fn().mockResolvedValue(undefined);
    const commands = createTwitchChatCommands(state, {
      backendBaseUrls: ['https://base.test'],
      commandsRefreshSeconds: 30,
      stoppedRef: { value: false },
      sayForChannel,
    });

    await commands.handleIncomingMessage({
      channel: '#streamer',
      tags: { 'user-id': 'u1', 'display-name': 'Viewer', mod: '1' },
      message: '!time',
      client: { say: vi.fn() } as unknown as { say: (login: string, message: string) => Promise<void> },
    });

    expect(sayForChannel).toHaveBeenCalledWith({
      channelId: 'channel-1',
      twitchLogin: 'streamer',
      message: 'Up 1h 1m',
    });
  });

  it('posts credits chatter for regular messages', async () => {
    const state: TwitchChatCommandState = {
      loginToSlug: new Map([['streamer', 'slug-1']]),
      loginToChannelId: new Map([['streamer', 'channel-1']]),
      commandsByChannelId: new Map([['channel-1', { ts: Date.now(), items: [] }]]),
      streamDurationByChannelId: new Map([['channel-1', { ts: Date.now(), cfg: null }]]),
    };

    const commands = createTwitchChatCommands(state, {
      backendBaseUrls: ['https://base.test'],
      commandsRefreshSeconds: 30,
      stoppedRef: { value: false },
      sayForChannel: vi.fn(),
    });

    await commands.handleIncomingMessage({
      channel: '#streamer',
      tags: { 'user-id': 'u1', 'display-name': 'Viewer' },
      message: 'hello chat',
      client: { say: vi.fn() } as unknown as { say: (login: string, message: string) => Promise<void> },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://base.test/internal/credits/chatter',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
