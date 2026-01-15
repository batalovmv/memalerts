import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmiMocks = vi.hoisted(() => {
  type FakeHandler = (...args: unknown[]) => unknown | Promise<unknown>;
  const clients: Array<{
    handlers: Map<string, FakeHandler>;
    opts: unknown;
    on: (event: string, handler: FakeHandler) => void;
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;
    emit: (event: string, ...args: unknown[]) => unknown;
  }> = [];

  class FakeClient {
    handlers = new Map<string, FakeHandler>();
    constructor(public opts: unknown) {
      clients.push(this);
    }
    on(event: string, handler: FakeHandler) {
      this.handlers.set(event, handler);
    }
    async connect() {
      return;
    }
    async disconnect() {
      return;
    }
    emit(event: string, ...args: unknown[]) {
      const handler = this.handlers.get(event);
      return handler ? handler(...args) : undefined;
    }
  }

  return { clients, FakeClient };
});

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findFirst: vi.fn() },
  channel: { findUnique: vi.fn() },
}));

const addCreditsChatter = vi.hoisted(() => vi.fn());
const emitCreditsState = vi.hoisted(() => vi.fn());
const getValidAccessToken = vi.hoisted(() => vi.fn());
const resolveMemalertsUserIdFromChatIdentity = vi.hoisted(() => vi.fn());
const shouldIgnoreCreditsChatter = vi.hoisted(() => vi.fn());
const getRedisClient = vi.hoisted(() => vi.fn());
const getStreamSessionSnapshot = vi.hoisted(() => vi.fn());
const claimPendingCoinGrantsTx = vi.hoisted(() => vi.fn());
const recordExternalRewardEventTx = vi.hoisted(() => vi.fn());
const stableProviderEventId = vi.hoisted(() => vi.fn());
const emitWalletUpdated = vi.hoisted(() => vi.fn());
const relayWalletUpdatedToPeer = vi.hoisted(() => vi.fn());

vi.mock('tmi.js', () => ({
  default: { Client: tmiMocks.FakeClient },
  Client: tmiMocks.FakeClient,
  __clients: tmiMocks.clients,
}));

vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/realtime/creditsSessionStore.js', () => ({ addCreditsChatter }));
vi.mock('../../src/realtime/creditsState.js', () => ({ emitCreditsState }));
vi.mock('../../src/utils/twitchApi.js', () => ({ getValidAccessToken }));
vi.mock('../../src/utils/chatIdentity.js', () => ({ resolveMemalertsUserIdFromChatIdentity }));
vi.mock('../../src/utils/creditsIgnore.js', () => ({ shouldIgnoreCreditsChatter }));
vi.mock('../../src/utils/redisClient.js', () => ({ getRedisClient }));
vi.mock('../../src/realtime/streamDurationStore.js', () => ({ getStreamSessionSnapshot }));
vi.mock('../../src/rewards/pendingCoinGrants.js', () => ({ claimPendingCoinGrantsTx }));
vi.mock('../../src/rewards/externalRewardEvents.js', () => ({ recordExternalRewardEventTx, stableProviderEventId }));
vi.mock('../../src/realtime/walletBridge.js', () => ({ emitWalletUpdated, relayWalletUpdatedToPeer }));

import { startTwitchChatBot } from '../../src/bots/twitchChatBot.js';

describe('twitch chat bot', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.CHAT_BOT_ENABLED = '1';
    process.env.CHAT_BOT_LOGIN = 'bot';
    process.env.CHAT_BOT_USER_ID = 'bot-user';
    process.env.CHAT_BOT_CHANNELS = 'mychan:slug-one';

    tmiMocks.clients.length = 0;
    vi.clearAllMocks();

    prismaMock.channel.findUnique.mockResolvedValue({
      id: 'channel-id',
      creditsReconnectWindowMinutes: 10,
      twitchAutoRewardsJson: null,
    });
    getValidAccessToken.mockResolvedValue('access-token');
    resolveMemalertsUserIdFromChatIdentity.mockResolvedValue(null);
    shouldIgnoreCreditsChatter.mockResolvedValue(false);
    getRedisClient.mockResolvedValue(null);
    getStreamSessionSnapshot.mockResolvedValue({ status: 'offline', sessionId: null });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('parses chat messages and emits credits events', async () => {
    const io = { to: () => ({ emit: vi.fn() }) } as unknown as Parameters<typeof startTwitchChatBot>[0];
    const bot = startTwitchChatBot(io);
    expect(bot).not.toBeNull();

    await new Promise((r) => setTimeout(r, 0));

    const client = tmiMocks.clients[0];
    expect(client).toBeTruthy();

    await client.emit(
      'message',
      '#mychan',
      { 'user-id': 'u1', 'display-name': 'Viewer', username: 'viewer' },
      'hello',
      false
    );

    expect(addCreditsChatter).toHaveBeenCalledWith('slug-one', 'twitch:u1', 'Viewer', null, 10);
    expect(emitCreditsState).toHaveBeenCalled();

    await bot?.stop();
  });

  it('ignores self messages and missing user identities', async () => {
    const io = { to: () => ({ emit: vi.fn() }) } as unknown as Parameters<typeof startTwitchChatBot>[0];
    const bot = startTwitchChatBot(io);

    await new Promise((r) => setTimeout(r, 0));

    const client = tmiMocks.clients[0];
    await client.emit(
      'message',
      '#mychan',
      { 'user-id': 'u1', 'display-name': 'Viewer', username: 'viewer' },
      'hello',
      true
    );
    await client.emit('message', '#mychan', { 'user-id': '', 'display-name': '' }, 'hello', false);

    expect(addCreditsChatter).not.toHaveBeenCalled();
    await bot?.stop();
  });
});
