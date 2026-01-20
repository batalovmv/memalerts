import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  channel: { findUnique: vi.fn() },
  $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({})),
}));
const recordExternalRewardEventTx = vi.hoisted(() => vi.fn());
const stableProviderEventId = vi.hoisted(() => vi.fn().mockReturnValue('stable-id'));
const loggerMock = vi.hoisted(() => ({ warn: vi.fn() }));
const autoRewardsMock = vi.hoisted(() => ({
  handleAutoRewards: vi.fn().mockResolvedValue({ skipCommands: false }),
}));

vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/rewards/externalRewardEvents.js', () => ({ recordExternalRewardEventTx, stableProviderEventId }));
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));
vi.mock('../../src/bots/trovoAutoRewards.js', () => ({
  createTrovoAutoRewards: () => autoRewardsMock,
}));

import { createTrovoRewardProcessor } from '../../src/bots/trovoRewardProcessor.js';
import type { TrovoChannelState } from '../../src/bots/trovoChatbotShared.js';

describe('trovo reward processor', () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records spell rewards and skips commands', async () => {
    prismaMock.channel.findUnique.mockResolvedValue({
      id: 'channel-1',
      slug: 'slug-1',
      trovoManaCoinsPerUnit: 2,
      trovoElixirCoinsPerUnit: 0,
    });

    const processor = createTrovoRewardProcessor();
    const res = await processor.handleChatRewards({
      st,
      envelope: { data: { eid: 'ev-1' } },
      chat: { type: 5, uid: 'trovo-user', content: JSON.stringify({ num: 3 }) },
    });

    expect(res).toEqual({ skipCommands: true });
    expect(recordExternalRewardEventTx).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'trovo_spell', coinsToGrant: 6 })
    );
  });

  it('delegates to auto rewards when no spell is present', async () => {
    const processor = createTrovoRewardProcessor();
    const res = await processor.handleChatRewards({
      st,
      envelope: {},
      chat: { type: 0, uid: 'trovo-user' },
    });

    expect(autoRewardsMock.handleAutoRewards).toHaveBeenCalled();
    expect(res).toEqual({ skipCommands: false });
  });
});
