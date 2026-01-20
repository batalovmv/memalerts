import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  kickChatBotOutboxMessage: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
}));
const sendToKickChat = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));

vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/bots/kickChatSender.js', () => ({ sendToKickChat }));
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));

import { createKickChatOutbox } from '../../src/bots/kickChatOutbox.js';
import type { KickChannelState } from '../../src/bots/kickChatbotShared.js';

describe('kick chat outbox', () => {
  const baseConfig = {
    outboxBullmqEnabled: false,
    outboxConcurrency: 1,
    outboxRateLimitMax: 20,
    outboxRateLimitWindowMs: 30_000,
    outboxLockTtlMs: 30_000,
    outboxLockDelayMs: 1_000,
    stoppedRef: { value: false },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends pending messages and marks them sent', async () => {
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
    const states = new Map<string, KickChannelState>([[st.channelId, st]]);

    prismaMock.kickChatBotOutboxMessage.findMany.mockResolvedValue([
      {
        id: 'outbox-1',
        channelId: 'channel-1',
        kickChannelId: 'kick-1',
        message: 'hi',
        status: 'pending',
        attempts: 0,
      },
    ]);
    prismaMock.kickChatBotOutboxMessage.updateMany.mockResolvedValue({ count: 1 });
    sendToKickChat.mockResolvedValue(undefined);

    const outbox = createKickChatOutbox(states, baseConfig);
    await outbox.processOutboxOnce();

    expect(sendToKickChat).toHaveBeenCalledWith({ st, text: 'hi' });
    expect(prismaMock.kickChatBotOutboxMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1' },
        data: expect.objectContaining({ status: 'sent' }),
      })
    );
  });

  it('marks messages failed after max attempts', async () => {
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
    const states = new Map<string, KickChannelState>([[st.channelId, st]]);

    prismaMock.kickChatBotOutboxMessage.findMany.mockResolvedValue([
      {
        id: 'outbox-2',
        channelId: 'channel-1',
        kickChannelId: 'kick-1',
        message: 'fail',
        status: 'pending',
        attempts: 2,
      },
    ]);
    prismaMock.kickChatBotOutboxMessage.updateMany.mockResolvedValue({ count: 1 });
    sendToKickChat.mockRejectedValue(new Error('boom'));

    const outbox = createKickChatOutbox(states, baseConfig);
    await outbox.processOutboxOnce();

    expect(prismaMock.kickChatBotOutboxMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-2' },
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
    expect(loggerMock.warn).toHaveBeenCalled();
  });
});
