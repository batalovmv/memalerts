import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  chatBotCommand: { findMany: vi.fn() },
}));
const getStreamDurationSnapshot = vi.hoisted(() => vi.fn());
const resolveMemalertsUserIdFromChatIdentity = vi.hoisted(() => vi.fn());
const getValidTrovoAccessTokenByExternalAccountId = vi.hoisted(() => vi.fn());
const getValidTrovoBotAccessToken = vi.hoisted(() => vi.fn());
const sendTrovoChatMessage = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));

vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/realtime/streamDurationStore.js', () => ({ getStreamDurationSnapshot }));
vi.mock('../../src/utils/chatIdentity.js', () => ({ resolveMemalertsUserIdFromChatIdentity }));
vi.mock('../../src/utils/trovoApi.js', () => ({
  getValidTrovoAccessTokenByExternalAccountId,
  getValidTrovoBotAccessToken,
  sendTrovoChatMessage,
}));
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));

import { createTrovoChatCommands } from '../../src/bots/trovoChatCommands.js';
import type { TrovoChannelState } from '../../src/bots/trovoChatbotShared.js';

describe('trovo chat commands', () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, TROVO_CLIENT_ID: 'trovo-client' };
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    getValidTrovoBotAccessToken.mockResolvedValue('bot-token');
    sendTrovoChatMessage.mockResolvedValue({ ok: true });
    resolveMemalertsUserIdFromChatIdentity.mockResolvedValue('mem-1');
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  it('replies to commands and posts credits chatter', async () => {
    const st: TrovoChannelState = {
      channelId: 'channel-1',
      userId: 'user-1',
      trovoChannelId: 'trovo-1',
      slug: 'slug-1',
      ws: null,
      wsToken: null,
      wsConnected: false,
      wsAuthNonce: null,
      wsPingTimer: null,
      wsPingGapSeconds: 0,
      lastConnectAt: 0,
      botExternalAccountId: null,
      commandsTs: 0,
      commands: [
        { triggerNormalized: '!ping', response: 'pong', onlyWhenLive: false, allowedUsers: [], allowedRoles: [] },
      ],
    };

    const states = new Map<string, TrovoChannelState>([[st.channelId, st]]);
    const commands = createTrovoChatCommands(states, {
      backendBaseUrls: ['https://base.test'],
      commandsRefreshSeconds: 30,
      stoppedRef: { value: false },
    });

    await commands.handleIncomingChat(st, {
      userId: 'trovo-user',
      displayName: 'Viewer',
      login: 'viewer',
      text: '!ping',
    });

    expect(sendTrovoChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'bot-token',
        clientId: 'trovo-client',
        trovoChannelId: 'trovo-1',
        content: 'pong',
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://base.test/internal/credits/chatter',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
