import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  kickChatBotSubscription: { findMany: vi.fn() },
  botIntegrationSettings: { findMany: vi.fn() },
  kickBotIntegration: { findMany: vi.fn() },
}));

vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));

import { createKickChatSubscriptions } from '../../src/bots/kickChatSubscriptions.js';
import type { KickChannelState } from '../../src/bots/kickChatbotShared.js';

describe('kick chat subscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('syncs enabled subscriptions with overrides and gating', async () => {
    prismaMock.kickChatBotSubscription.findMany.mockResolvedValue([
      {
        channelId: 'channel-1',
        userId: 'user-1',
        kickChannelId: 'kick-1',
        channel: { slug: 'Slug-1' },
      },
      {
        channelId: 'channel-2',
        userId: 'user-2',
        kickChannelId: 'kick-2',
        channel: { slug: 'slug-2' },
      },
    ]);
    prismaMock.botIntegrationSettings.findMany.mockResolvedValue([
      { channelId: 'channel-1', enabled: true },
      { channelId: 'channel-2', enabled: false },
    ]);
    prismaMock.kickBotIntegration.findMany.mockResolvedValue([{ channelId: 'channel-1', externalAccountId: 'ext-1' }]);

    const states = new Map<string, KickChannelState>([
      [
        'remove-me',
        {
          channelId: 'remove-me',
          userId: 'user-old',
          kickChannelId: 'kick-old',
          slug: 'old',
          botExternalAccountId: null,
          commandsTs: 0,
          commands: [],
          chatCursor: null,
        },
      ],
    ]);

    const subs = createKickChatSubscriptions({ states, stoppedRef: { value: false } });
    await subs.syncSubscriptions();

    expect(states.has('remove-me')).toBe(false);
    expect(states.has('channel-2')).toBe(false);
    const st = states.get('channel-1');
    expect(st?.kickChannelId).toBe('kick-1');
    expect(st?.slug).toBe('slug-1');
    expect(st?.botExternalAccountId).toBe('ext-1');
  });
});
