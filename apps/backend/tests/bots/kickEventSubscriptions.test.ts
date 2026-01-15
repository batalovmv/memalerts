import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const kickApiMocks = vi.hoisted(() => ({
  createKickEventSubscription: vi.fn(),
  getKickExternalAccount: vi.fn(),
  getValidKickAccessTokenByExternalAccountId: vi.fn(),
  listKickEventSubscriptions: vi.fn(),
}));
const loggerMock = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn() }));

vi.mock('../../src/utils/kickApi.js', () => kickApiMocks);
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));

import { createKickEventSubscriptions } from '../../src/bots/kickEventSubscriptions.js';
import type { KickChannelState } from '../../src/bots/kickChatbotShared.js';

describe('kick event subscriptions', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.KICK_WEBHOOK_CALLBACK_URL = 'https://example.test/webhooks/kick/events';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('creates missing event subscriptions', async () => {
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

    kickApiMocks.getKickExternalAccount.mockResolvedValue({ id: 'acc-1' });
    kickApiMocks.getValidKickAccessTokenByExternalAccountId.mockResolvedValue('token');
    kickApiMocks.listKickEventSubscriptions.mockResolvedValue({
      ok: true,
      subscriptions: [
        {
          event: 'chat.message.sent',
          callback_url: 'https://example.test/webhooks/kick/events',
        },
      ],
    });
    kickApiMocks.createKickEventSubscription.mockResolvedValue({ ok: true, subscriptionId: 'sub-1' });

    const eventSubs = createKickEventSubscriptions({ states, stoppedRef: { value: false } });
    await eventSubs.ensureKickEventSubscriptions();

    expect(kickApiMocks.createKickEventSubscription).toHaveBeenCalledTimes(7);
    const events = new Set(kickApiMocks.createKickEventSubscription.mock.calls.map((call) => call[0]?.event));
    expect(events.has('chat.message.sent')).toBe(false);
    expect(events.has('channel.followed')).toBe(true);
    expect(events.has('livestream.status.updated')).toBe(true);
    expect(kickApiMocks.createKickEventSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackUrl: 'https://example.test/webhooks/kick/events',
        version: 'v1',
      })
    );
  });
});
