import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmiMocks = vi.hoisted(() => {
  const clients: Array<{
    opts: unknown;
    join: ReturnType<typeof vi.fn>;
    say: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
  }> = [];
  class FakeClient {
    join = vi.fn().mockResolvedValue(undefined);
    say = vi.fn().mockResolvedValue(undefined);
    on = vi.fn();
    connect = vi.fn().mockResolvedValue(undefined);
    constructor(public opts: unknown) {
      clients.push(this);
    }
  }
  return { clients, FakeClient };
});

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findFirst: vi.fn() },
  externalAccount: { findUnique: vi.fn() },
}));
const getValidTwitchAccessTokenByExternalAccountId = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn() }));

vi.mock('tmi.js', () => ({ default: { Client: tmiMocks.FakeClient }, Client: tmiMocks.FakeClient }));
vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/utils/twitchApi.js', () => ({ getValidTwitchAccessTokenByExternalAccountId }));
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));

import { resolveBotUserId, sayForChannel } from '../../src/bots/twitchChatClients.js';

describe('twitch chat clients', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('resolves explicit bot user id', async () => {
    process.env.CHAT_BOT_USER_ID = 'user-1';
    await expect(resolveBotUserId()).resolves.toBe('user-1');
  });

  it('uses override client to send messages', async () => {
    prismaMock.externalAccount.findUnique.mockResolvedValue({
      id: 'ext-1',
      provider: 'twitch',
      login: 'OverrideBot',
    });
    getValidTwitchAccessTokenByExternalAccountId.mockResolvedValue('token-1');

    const defaultClientRef = { value: { client: { say: vi.fn() } } };
    const overrideClients = new Map();
    const channelIdToOverrideExtId = new Map([['channel-1', 'ext-1']]);

    await sayForChannel({
      defaultClientRef,
      overrideClients,
      channelIdToOverrideExtId,
      channelId: 'channel-1',
      twitchLogin: 'streamer',
      message: 'hello',
    });

    const override = overrideClients.get('ext-1');
    expect(override).toBeTruthy();
    expect(override.client.say).toHaveBeenCalledWith('streamer', 'hello');
    expect(defaultClientRef.value.client.say).not.toHaveBeenCalled();
  });
});
