import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getValidKickAccessTokenByExternalAccountId = vi.hoisted(() => vi.fn());
const getValidKickBotAccessToken = vi.hoisted(() => vi.fn());
const sendKickChatMessage = vi.hoisted(() => vi.fn());

vi.mock('../../src/utils/kickApi.js', () => ({
  getValidKickAccessTokenByExternalAccountId,
  getValidKickBotAccessToken,
  sendKickChatMessage,
}));

import { sendToKickChat } from '../../src/bots/kickChatSender.js';
import type { KickChannelState } from '../../src/bots/kickChatbotShared.js';

describe('kick chat sender', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws when send URL is missing', async () => {
    const st: KickChannelState = {
      channelId: 'channel-1',
      userId: 'user-1',
      kickChannelId: 'kick-1',
      slug: 'slug-1',
      botExternalAccountId: null,
      commandsTs: 0,
      commands: [],
      chatCursor: null,
    };

    await expect(sendToKickChat({ st, text: 'hello' })).rejects.toThrow('KICK_SEND_CHAT_URL is not configured');
  });

  it('sends chat messages with bot token', async () => {
    process.env.KICK_SEND_CHAT_URL = 'https://kick.example/send';
    getValidKickBotAccessToken.mockResolvedValue('token-1');
    sendKickChatMessage.mockResolvedValue({ ok: true });

    const st: KickChannelState = {
      channelId: 'channel-1',
      userId: 'user-1',
      kickChannelId: 'kick-1',
      slug: 'slug-1',
      botExternalAccountId: null,
      commandsTs: 0,
      commands: [],
      chatCursor: null,
    };

    await sendToKickChat({ st, text: ' hello ' });

    expect(sendKickChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'token-1',
        kickChannelId: 'kick-1',
        content: 'hello',
        sendChatUrl: 'https://kick.example/send',
      })
    );
  });
});
