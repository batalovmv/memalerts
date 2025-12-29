import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';

import { BotSettings } from './BotSettings';
import { renderWithProviders } from '@/test/test-utils';
import { server } from '@/test/msw/server';
import {
  mockStreamerBotOverrideStatus,
  mockStreamerBotSubscription,
  mockStreamerBots,
  mockStreamerCustomBotEntitlement,
  mockStreamerFollowGreetings,
} from '@/test/msw/handlers';
import { http, HttpResponse } from 'msw';
import { makeStreamerUser } from '@/test/fixtures/user';

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Avoid slow UX delays in bot flows (not needed for integration assertions here).
vi.mock('@/shared/lib/ensureMinDuration', () => ({
  ensureMinDuration: async () => {},
}));

describe('BotSettings (integration)', () => {
  it('enables YouTube bot integration via PATCH /streamer/bots/youtube', async () => {
    const user = userEvent.setup();

    const me = makeStreamerUser({
      role: 'streamer',
      channel: { id: 'c1', slug: 's1', name: 'S', twitchChannelId: 't1' } as any,
      externalAccounts: [{ id: 'acc_yt', provider: 'youtube', providerAccountId: 'yt1', login: 'myyt', displayName: 'YT' } as any],
    });

    const patchAssert = vi.fn();

    server.use(
      mockStreamerBotSubscription({ enabled: true }),
      mockStreamerCustomBotEntitlement({ entitled: true }),
      mockStreamerFollowGreetings({ followGreetingsEnabled: false, followGreetingTemplate: '' }),
      mockStreamerBots([{ provider: 'youtube', enabled: false }, { provider: 'vkvideo', enabled: false }, { provider: 'twitch', enabled: false }]),
      mockStreamerBotOverrideStatus('youtube', { enabled: false, updatedAt: null, externalAccountId: null, lockedBySubscription: false }),
      // BotSettings may prefetch these on mount (depending on feature flags / backend):
      http.options('*/streamer/bot/commands', () => new HttpResponse(null, { status: 204 })),
      http.get('*/streamer/bot/commands', () => HttpResponse.json({ items: [] })),
      http.options('*/streamer/bot/stream-duration', () => new HttpResponse(null, { status: 204 })),
      http.get('*/streamer/bot/stream-duration', () =>
        HttpResponse.json({ enabled: false, trigger: '!time', responseTemplate: '', breakCreditMinutes: 60, onlyWhenLive: false }),
      ),
      // PATCH integration toggle
      http.patch('*/streamer/bots/youtube', async ({ request }) => {
        const body = (await request.json().catch(() => null)) as unknown;
        patchAssert(body);
        return HttpResponse.json({ ok: true });
      }),
    );

    renderWithProviders(<BotSettings />, {
      route: '/settings/bot',
      preloadedState: { auth: { user: me, loading: false, error: null } } as any,
    });

    // Navigate to YouTube tab.
    await user.click(screen.getByRole('button', { name: /^youtube$/i }));

    // Toggle integration on.
    const checkbox = await screen.findByRole('checkbox', { name: /youtube bot enabled/i });
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);

    await waitFor(() => expect(patchAssert).toHaveBeenCalledWith({ enabled: true }));
  });
});


