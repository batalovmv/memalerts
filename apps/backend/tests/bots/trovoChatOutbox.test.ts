import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  trovoChatBotOutboxMessage: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
}));
const sendToTrovoChat = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));

vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/bots/trovoChatCommands.js', () => ({ sendToTrovoChat }));
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));

import { createTrovoChatOutbox } from '../../src/bots/trovoChatOutbox.js';
import type { TrovoChannelState } from '../../src/bots/trovoChatbotShared.js';

describe('trovo chat outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends pending outbox messages', async () => {
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
      commands: [],
    };
    const states = new Map<string, TrovoChannelState>([[st.channelId, st]]);

    prismaMock.trovoChatBotOutboxMessage.findMany.mockResolvedValue([
      {
        id: 'outbox-1',
        channelId: 'channel-1',
        trovoChannelId: 'trovo-1',
        message: 'hello',
        status: 'pending',
        attempts: 0,
      },
    ]);
    prismaMock.trovoChatBotOutboxMessage.updateMany.mockResolvedValue({ count: 1 });

    const outbox = createTrovoChatOutbox(states, {
      outboxBullmqEnabled: false,
      outboxConcurrency: 1,
      outboxRateLimitMax: 20,
      outboxRateLimitWindowMs: 30_000,
      outboxLockTtlMs: 30_000,
      outboxLockDelayMs: 1_000,
      stoppedRef: { value: false },
    });

    await outbox.processOutboxOnce();

    expect(sendToTrovoChat).toHaveBeenCalledWith({ st, text: 'hello' });
    expect(prismaMock.trovoChatBotOutboxMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1' },
        data: expect.objectContaining({ status: 'sent' }),
      })
    );
  });
});
