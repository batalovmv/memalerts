import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  chatBotCommand: { findMany: vi.fn() },
}));

const getStreamDurationSnapshot = vi.hoisted(() => vi.fn());
const resolveMemalertsUserIdFromChatIdentity = vi.hoisted(() => vi.fn());
const sendToKickChat = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));

vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/realtime/streamDurationStore.js', () => ({ getStreamDurationSnapshot }));
vi.mock('../../src/utils/chatIdentity.js', () => ({ resolveMemalertsUserIdFromChatIdentity }));
vi.mock('../../src/bots/kickChatSender.js', () => ({ sendToKickChat }));
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));

import { createKickChatCommands } from '../../src/bots/kickChatCommands.js';

describe('kick chat commands', () => {
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

  it('refreshes commands and normalizes fields', async () => {
    const states = new Map<
      string,
      {
        channelId: string;
        userId: string;
        kickChannelId: string;
        slug: string;
        botExternalAccountId: string | null;
        commandsTs: number;
        commands: unknown[];
        chatCursor: string | null;
      }
    >();
    const st = {
      channelId: 'channel-1',
      userId: 'user-1',
      kickChannelId: 'kick-1',
      slug: 'slug',
      botExternalAccountId: null,
      commandsTs: 0,
      commands: [],
      chatCursor: null,
    };
    states.set(st.channelId, st);

    prismaMock.chatBotCommand.findMany.mockResolvedValue([
      {
        channelId: 'channel-1',
        triggerNormalized: ' HeLLo ',
        response: 'Hi!',
        onlyWhenLive: false,
        allowedUsers: ['@Admin', 'UserTwo'],
        allowedRoles: ['mod'],
      },
      { channelId: 'channel-1', triggerNormalized: '', response: 'skip', onlyWhenLive: false },
    ]);

    const commands = createKickChatCommands(states, {
      backendBaseUrls: ['https://internal.test'],
      commandsRefreshSeconds: 30,
      stoppedRef: { value: false },
    });

    await commands.refreshCommands();

    expect(st.commands).toEqual([
      {
        triggerNormalized: 'hello',
        response: 'Hi!',
        onlyWhenLive: false,
        allowedUsers: ['admin', 'usertwo'],
        allowedRoles: ['mod'],
      },
    ]);
    expect(st.commandsTs).toBeGreaterThan(0);
  });

  it('posts credits chatter and replies when command matches', async () => {
    const states = new Map<
      string,
      {
        channelId: string;
        userId: string;
        kickChannelId: string;
        slug: string;
        botExternalAccountId: string | null;
        commandsTs: number;
        commands: Array<{
          triggerNormalized: string;
          response: string;
          onlyWhenLive: boolean;
          allowedUsers: string[];
          allowedRoles: string[];
        }>;
        chatCursor: string | null;
      }
    >();
    const st = {
      channelId: 'channel-1',
      userId: 'user-1',
      kickChannelId: 'kick-1',
      slug: 'slug',
      botExternalAccountId: null,
      commandsTs: 0,
      commands: [
        { triggerNormalized: 'ping', response: 'pong', onlyWhenLive: true, allowedUsers: [], allowedRoles: [] },
      ],
      chatCursor: null,
    };
    states.set(st.channelId, st);

    resolveMemalertsUserIdFromChatIdentity.mockResolvedValue('mem-1');
    getStreamDurationSnapshot.mockResolvedValue({ status: 'online', totalMinutes: 5 });

    const commands = createKickChatCommands(states, {
      backendBaseUrls: ['https://base-one.test', 'https://base-two.test'],
      commandsRefreshSeconds: 30,
      stoppedRef: { value: false },
    });

    await commands.handleIncomingChat(st, {
      userId: 'kick-user',
      displayName: 'Viewer',
      login: 'viewer',
      text: 'Ping',
    });

    expect(sendToKickChat).toHaveBeenCalledWith({ st, text: 'pong' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://base-one.test/internal/credits/chatter');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://base-two.test/internal/credits/chatter');
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}'));
    expect(payload).toEqual({ channelSlug: 'slug', userId: 'mem-1', displayName: 'Viewer' });
  });
});
