import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  chatBotOutboxMessage: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
}));
const loggerMock = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));

vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));

import { createTwitchChatOutbox } from '../../src/bots/twitchChatOutbox.js';

describe('twitch chat outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends pending outbox messages', async () => {
    prismaMock.chatBotOutboxMessage.findMany.mockResolvedValue([
      {
        id: 'outbox-1',
        twitchLogin: 'streamer',
        message: 'hello',
        status: 'pending',
        attempts: 0,
      },
    ]);
    prismaMock.chatBotOutboxMessage.updateMany.mockResolvedValue({ count: 1 });

    const sayForChannel = vi.fn().mockResolvedValue(undefined);
    const outbox = createTwitchChatOutbox({
      loginToChannelId: new Map([['streamer', 'channel-1']]),
      joinedDefault: new Set(['streamer']),
      defaultClientRef: { value: { client: {} } },
      sayForChannel,
      config: {
        outboxBullmqEnabled: false,
        outboxConcurrency: 1,
        outboxRateLimitMax: 20,
        outboxRateLimitWindowMs: 30_000,
        outboxLockTtlMs: 30_000,
        outboxLockDelayMs: 1_000,
        stoppedRef: { value: false },
      },
    });

    await outbox.processOutboxOnce();

    expect(sayForChannel).toHaveBeenCalledWith({
      channelId: 'channel-1',
      twitchLogin: 'streamer',
      message: 'hello',
    });
    expect(prismaMock.chatBotOutboxMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1' },
        data: expect.objectContaining({ status: 'sent' }),
      })
    );
  });
});
