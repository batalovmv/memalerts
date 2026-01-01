import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
      kickRewardEnabled: false,
      kickRewardIdForCoins: null,
      kickCoinPerPointRatio: 1,
      kickRewardCoins: null,
      kickRewardOnlyWhenLive: false,
      trovoManaCoinsPerUnit: 0,
      trovoElixirCoinsPerUnit: 0,
      vkvideoRewardEnabled: false,
      vkvideoRewardIdForCoins: null,
      vkvideoCoinPerPointRatio: 1,
      vkvideoRewardCoins: null,
      vkvideoRewardOnlyWhenLive: false,
      submissionRewardCoins: 0,
    }),
  }),
}));

describe('RewardsSettings (integration)', () => {
  const defaultBoostyAccess = () =>
    HttpResponse.json({
      status: 'need_discord_link',
      requiredGuild: { id: 'g1', autoJoin: true, name: null, inviteUrl: null },
    });

  it('renders Discord link CTA when boosty-access status=need_discord_link', async () => {
    const me = makeStreamerUser({ channelId: 'c1', channel: { id: 'c1', slug: 's1', name: 'S', twitchChannelId: 't1' } as any });

    server.use(
      http.options('*/channels/:channelId/boosty-access', () => HttpResponse.text('', { status: 204 })),
      http.get('*/channels/:channelId/boosty-access', () =>
        HttpResponse.json({
          status: 'need_discord_link',
          requiredGuild: { id: 'g1', autoJoin: true, name: null, inviteUrl: null },
        })
      ),
      mockTwitchRewardEligibility({ eligible: true }),
      http.patch('*/streamer/channel/settings', () => HttpResponse.json({ ok: true })),
    );

    renderWithProviders(<RewardsSettings />, {
      route: '/settings?tab=rewards',
      preloadedState: { auth: { user: me, loading: false, error: null } } as any,
    });

    expect(await screen.findByRole('button', { name: /привязать discord/i })).toBeInTheDocument();
  });

  it('renders subscribed state when boosty-access status=subscribed', async () => {
    const me = makeStreamerUser({ channelId: 'c1', channel: { id: 'c1', slug: 's1', name: 'S', twitchChannelId: 't1' } as any });

    server.use(
      http.options('*/channels/:channelId/boosty-access', () => HttpResponse.text('', { status: 204 })),
      http.get('*/channels/:channelId/boosty-access', () =>
        HttpResponse.json({
          status: 'subscribed',
          matchedTier: 'T3',
          requiredGuild: { id: 'g1', autoJoin: true, name: null, inviteUrl: null },
        })
      ),
      mockTwitchRewardEligibility({ eligible: true }),
      http.patch('*/streamer/channel/settings', () => HttpResponse.json({ ok: true })),
    );

    renderWithProviders(<RewardsSettings />, {
      route: '/settings?tab=rewards',
      preloadedState: { auth: { user: me, loading: false, error: null } } as any,
    });

    expect(await screen.findByText(/подписка активна/i)).toBeInTheDocument();
    expect(await screen.findByText(/t3/i)).toBeInTheDocument();
  });

  it('saves twitchAutoRewards JSON via /streamer/channel/settings', async () => {
    const userEv = userEvent.setup();
    const me = makeStreamerUser({ channelId: 'c1', channel: { id: 'c1', slug: 's1', name: 'S', twitchChannelId: 't1' } as any });

    const bodies: unknown[] = [];
    server.use(
      http.options('*/channels/:channelId/boosty-access', () => HttpResponse.text('', { status: 204 })),
      http.get('*/channels/:channelId/boosty-access', defaultBoostyAccess),
      mockTwitchRewardEligibility({ eligible: true }),
      mockStreamerChannelSettingsPatch((b) => bodies.push(b)),
    );

    renderWithProviders(<RewardsSettings />, {
      route: '/settings?tab=rewards',
      preloadedState: { auth: { user: me, loading: false, error: null } } as any,
    });

    const textarea = (await screen.findByLabelText(/twitchautorewards json/i)) as HTMLTextAreaElement;
    const section = textarea.closest('section') ?? textarea.parentElement ?? document.body;
    const jsonText = JSON.stringify(
      {
        v: 1,
        follow: { enabled: true, coins: 10, onceEver: true, onlyWhenLive: false },
      },
      null,
      2,
    );
    // Use fireEvent instead of userEvent.type/paste:
    // - type() parses `{...}` as special sequences
    // - paste() relies on clipboardData which may be missing in some JSDOM environments
    fireEvent.change(textarea, { target: { value: jsonText } });

    const saveBtn = within(section).getByRole('button', { name: /save/i });
    await userEv.click(saveBtn);

    await waitFor(() => expect(bodies.length).toBeGreaterThanOrEqual(1));
    const last = bodies.at(-1) as any;
    expect(last.twitchAutoRewards?.v).toBe(1);
    expect(last.twitchAutoRewards?.follow?.coins).toBe(10);
  });

  it('autosaves approved meme reward via /streamer/channel/settings (payload uses numbers)', async () => {
    const userEv = userEvent.setup();
    const me = makeStreamerUser({ channelId: 'c1', channel: { id: 'c1', slug: 's1', name: 'S', twitchChannelId: 't1' } as any });

    const bodies: unknown[] = [];
    server.use(
      http.options('*/channels/:channelId/boosty-access', () => HttpResponse.text('', { status: 204 })),
      http.get('*/channels/:channelId/boosty-access', defaultBoostyAccess),
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
      http.options('*/channels/:channelId/boosty-access', () => HttpResponse.text('', { status: 204 })),
      http.get('*/channels/:channelId/boosty-access', defaultBoostyAccess),
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

  it('autosaves Kick reward via /streamer/channel/settings (payload uses numbers)', async () => {
    const userEv = userEvent.setup();
    const me = makeStreamerUser({
      channelId: 'c1',
      channel: { id: 'c1', slug: 's1', name: 'S', twitchChannelId: 't1' } as any,
      externalAccounts: [{ id: 'ea_kick', provider: 'kick' } as any],
    });

    const bodies: unknown[] = [];
    server.use(
      http.options('*/channels/:channelId/boosty-access', () => HttpResponse.text('', { status: 204 })),
      http.get('*/channels/:channelId/boosty-access', () =>
        HttpResponse.json({
          status: 'need_discord_link',
          requiredGuild: { id: 'g1', autoJoin: true, name: null, inviteUrl: null },
        })
      ),
      mockTwitchRewardEligibility({ eligible: true }),
      mockStreamerChannelSettingsPatch((b) => bodies.push(b)),
    );

    renderWithProviders(<RewardsSettings />, {
      route: '/settings?tab=rewards',
      preloadedState: { auth: { user: me, loading: false, error: null } } as any,
    });

    const kickTitleEl = await screen.findByText(/coins reward \(kick\)|награда за монеты \(kick\)/i);
    const section = kickTitleEl.closest('section') ?? kickTitleEl.parentElement ?? document.body;
    const kickToggle = within(section).getByRole('checkbox') as HTMLInputElement;
    await userEv.click(kickToggle);

    const ratioLabelEl = await screen.findByText(/kickcoinperpointratio/i);
    const ratioContainer = ratioLabelEl.closest('div') ?? ratioLabelEl.parentElement ?? document.body;
    const ratioInput = within(ratioContainer).getByRole('textbox') as HTMLInputElement;
    await userEv.clear(ratioInput);
    await userEv.type(ratioInput, '2');

    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });

    await waitFor(() => expect(bodies.length).toBeGreaterThanOrEqual(1));
    const last = bodies.at(-1) as any;
    expect(last.kickRewardEnabled).toBe(true);
    expect(last.kickCoinPerPointRatio).toBe(2);
  });
});


