import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { RewardsSettings } from './RewardsSettings';
import { renderWithProviders } from '@/test/test-utils';
import { server } from '@/test/msw/server';
import { mockStreamerChannelSettingsPatch, mockTwitchRewardEligibility } from '@/test/msw/handlers';
import { makeStreamerUser } from '@/test/fixtures/user';

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/shared/lib/ensureMinDuration', () => ({
  ensureMinDuration: async () => {},
}));

vi.mock('@/contexts/ChannelColorsContext', () => ({
  useChannelColors: () => ({
    getChannelData: async () => null,
    getCachedChannelData: () => ({
      id: 'c1',
      slug: 's1',
      name: 'S',
      coinPerPointRatio: 1,
      submissionRewardCoinsUpload: 0,
      submissionRewardCoinsPool: 0,
      submissionRewardOnlyWhenLive: false,
      rewardIdForCoins: 'rw_1',
      rewardEnabled: false,
      rewardTitle: null,
      rewardCost: null,
      rewardCoins: null,
      rewardOnlyWhenLive: false,
      submissionRewardCoins: 0,
    }),
  }),
}));

describe('RewardsSettings (integration)', () => {
  it('autosaves approved meme reward via /streamer/channel/settings (payload uses numbers)', async () => {
    const userEv = userEvent.setup();
    const me = makeStreamerUser({ channelId: 'c1', channel: { id: 'c1', slug: 's1', name: 'S', twitchChannelId: 't1' } as any });

    const bodies: unknown[] = [];
    server.use(
      mockTwitchRewardEligibility({ eligible: true }),
      mockStreamerChannelSettingsPatch((b) => bodies.push(b)),
    );

    renderWithProviders(<RewardsSettings />, {
      route: '/settings?tab=rewards',
      preloadedState: { auth: { user: me, loading: false, error: null } } as any,
    });

    // Change upload reward to 10 (this triggers debounced autosave).
    const uploadLabelEl = await screen.findByText(/reward \(upload \/ url\) \(coins\)/i);
    const uploadContainer = uploadLabelEl.closest('div') ?? uploadLabelEl.parentElement ?? document.body;
    const uploadInput = within(uploadContainer).getByRole('textbox') as HTMLInputElement;
    await userEv.clear(uploadInput);
    await userEv.type(uploadInput, '10');

    // Wait for autosave debounce + request.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });

    await waitFor(() => expect(bodies.length).toBeGreaterThanOrEqual(1));
    const last = bodies.at(-1) as any;
    expect(last.submissionRewardCoinsUpload).toBe(10);
    expect(last.submissionRewardCoinsPool).toBe(0);
    expect(last.submissionRewardOnlyWhenLive).toBe(false);
  });

  it('invalid approved meme reward (empty) shows toast error and does not PATCH', async () => {
    const userEv = userEvent.setup();
    const me = makeStreamerUser({ channelId: 'c1', channel: { id: 'c1', slug: 's1', name: 'S', twitchChannelId: 't1' } as any });

    server.use(
      mockTwitchRewardEligibility({ eligible: true }),
      http.patch('*/streamer/channel/settings', () => HttpResponse.json({ error: 'Boom' }, { status: 500 })),
    );

    renderWithProviders(<RewardsSettings />, {
      route: '/settings?tab=rewards',
      preloadedState: { auth: { user: me, loading: false, error: null } } as any,
    });

    const uploadLabelEl = await screen.findByText(/reward \(upload \/ url\) \(coins\)/i);
    const uploadContainer = uploadLabelEl.closest('div') ?? uploadLabelEl.parentElement ?? document.body;
    const uploadInput = within(uploadContainer).getByRole('textbox') as HTMLInputElement;

    // Trigger autosave; backend will return 500 -> toast.error.
    await userEv.type(uploadInput, '10');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });

    const toast = (await import('react-hot-toast')).default as unknown as { error: ReturnType<typeof vi.fn> };
    expect(toast.error).toHaveBeenCalled();
  });
});


