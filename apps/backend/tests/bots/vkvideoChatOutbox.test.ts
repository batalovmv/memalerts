import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vkVideoChatBotOutboxMessage: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
}));
const loggerMock = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));

vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));

import { createVkvideoChatOutbox } from '../../src/bots/vkvideoChatOutbox.js';

describe('vkvideo chat outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends pending outbox messages', async () => {
    prismaMock.vkVideoChatBotOutboxMessage.findMany.mockResolvedValue([
      {
        id: 'outbox-1',
        vkvideoChannelId: 'vk-1',
        message: ' hello ',
        status: 'pending',
        attempts: 0,
      },
    ]);
    prismaMock.vkVideoChatBotOutboxMessage.updateMany.mockResolvedValue({ count: 1 });

    const sendToVkVideoChat = vi.fn().mockResolvedValue(undefined);
    const outbox = createVkvideoChatOutbox(
      { vkvideoIdToChannelId: new Map([['vk-1', 'channel-1']]) },
      {
        outboxBullmqEnabled: false,
        outboxConcurrency: 1,
        outboxRateLimitMax: 20,
        outboxRateLimitWindowMs: 30_000,
        outboxLockTtlMs: 30_000,
        outboxLockDelayMs: 1_000,
        stoppedRef: { value: false },
      },
      sendToVkVideoChat
    );

    await outbox.processOutboxOnce();

    expect(sendToVkVideoChat).toHaveBeenCalledWith({ vkvideoChannelId: 'vk-1', text: 'hello' });
    expect(prismaMock.vkVideoChatBotOutboxMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1' },
        data: expect.objectContaining({ status: 'sent' }),
      })
    );
  });
});
