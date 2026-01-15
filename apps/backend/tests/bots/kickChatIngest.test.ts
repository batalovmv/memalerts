import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const kickApiMocks = vi.hoisted(() => ({
  getKickExternalAccount: vi.fn(),
  getValidKickAccessTokenByExternalAccountId: vi.fn(),
}));
const loggerMock = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('../../src/utils/kickApi.js', () => kickApiMocks);
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));

import { createKickChatIngest } from '../../src/bots/kickChatIngest.js';
import type { KickChannelState } from '../../src/bots/kickChatbotShared.js';

describe('kick chat ingest', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn() });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('polls chat and forwards messages', async () => {
    kickApiMocks.getKickExternalAccount.mockResolvedValue({ id: 'acc-1' });
    kickApiMocks.getValidKickAccessTokenByExternalAccountId.mockResolvedValue('token');
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        cursor: 'cur-2',
        data: [
          {
            sender: { id: 'u1', username: '@Viewer', display_name: 'Viewer' },
            content: ' hello ',
          },
        ],
      }),
    });

    const st: KickChannelState = {
      channelId: 'channel-1',
      userId: 'user-1',
      kickChannelId: 'kick-1',
      slug: 'slug-1',
      botExternalAccountId: null,
      commandsTs: 0,
      commands: [],
      chatCursor: 'cur-1',
    };
    const states = new Map<string, KickChannelState>([[st.channelId, st]]);
    const handleIncomingChat = vi.fn();

    const ingest = createKickChatIngest(states, { handleIncomingChat }, {
      chatPollUrlTemplate: 'https://kick.test/channels/{channelId}/chat?cursor={cursor}',
      stoppedRef: { value: false },
    });

    await ingest.ingestChatOnce();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://kick.test/channels/kick-1/chat?cursor=cur-1',
      expect.objectContaining({
        headers: { Accept: 'application/json', Authorization: 'Bearer token' },
      })
    );
    expect(handleIncomingChat).toHaveBeenCalledWith(
      st,
      expect.objectContaining({
        userId: 'u1',
        displayName: 'Viewer',
        login: 'viewer',
        text: 'hello',
        cursor: 'cur-2',
      })
    );
    expect(st.chatCursor).toBe('cur-2');
  });
});
