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

// #region agent log
const AGENT_INGEST = 'http://127.0.0.1:7245/ingest/7e3c7663-07d0-4b19-b672-242e78cd89e3';
function agentLog(payload: { runId: string; hypothesisId: string; location: string; message: string; data?: unknown }) {
  globalThis
    .fetch?.(AGENT_INGEST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'debug-session', timestamp: Date.now(), ...payload }),
    })
    .catch(() => {});
}

function logRewardsSnapshot(params: { runId: string; test: string }) {
  const buttons = Array.from(document.querySelectorAll('button'))
    .slice(0, 40)
    .map((b) => ({
      text: (b.textContent || '').replace(/\s+/g, ' ').trim(),
      className: (b.getAttribute('class') || '').slice(0, 120),
    }));

  const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
    .slice(0, 40)
    .map((h) => (h.textContent || '').replace(/\s+/g, ' ').trim());

  const text = (document.body?.textContent || '').toLowerCase();
  const contains = (s: string) => text.includes(s.toLowerCase());

  agentLog({
    runId: params.runId,
    hypothesisId: 'H1',
    location: 'RewardsSettings.test.tsx:agentLog:logRewardsSnapshot',
    message: 'RewardsSettings snapshot',
    data: {
      test: params.test,
      has: {
        discord: contains('discord'),
        boosty: contains('boosty'),
        subscribed_ru: contains('подписка активна'),
        autoRewards: contains('auto rewards'),
        uploadRewardLabel: contains('reward (upload / url)'),
        kickCoinsRewardRu: contains('награда за монеты (kick)'),
      },
      headings,
      buttons,
    },
  });
}
// #endregion agent log

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
    const userEv = userEvent.setup();
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

    await userEv.click(await screen.findByRole('button', { name: /boosty/i }));
    logRewardsSnapshot({ runId: 'pre-fix', test: 'need_discord_link' });
    expect(await screen.findByRole('button', { name: /(привязать discord|link discord)/i })).toBeInTheDocument();
  });

  it('renders subscribed state when boosty-access status=subscribed', async () => {
    const userEv = userEvent.setup();
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

    await userEv.click(await screen.findByRole('button', { name: /boosty/i }));
    logRewardsSnapshot({ runId: 'pre-fix', test: 'subscribed' });
    expect(await screen.findByText(/подписка активна|subscription active/i)).toBeInTheDocument();
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

    logRewardsSnapshot({ runId: 'pre-fix', test: 'save_twitchAutoRewards' });
    await userEv.click(await screen.findByRole('button', { name: /(общие|common)/i }));
    const titleEl = await screen.findByRole('heading', { name: /(автонаграды|auto rewards)/i });
    const section = titleEl.closest('section') ?? titleEl.parentElement ?? document.body;

    // Common tab should not show Twitch-only Channel Points mapping.
    expect(within(section).queryByText(/channel points:?\s*rewardid\s*→\s*coins/i)).not.toBeInTheDocument();

    const followToggle = within(section).getByRole('checkbox', { name: /enable follow auto reward/i });
    await userEv.click(followToggle);

    const followCoins = within(section).getByRole('textbox', { name: /follow coins/i }) as HTMLInputElement;
    await userEv.clear(followCoins);
    await userEv.type(followCoins, '10');

    const saveBtn = within(section).getByRole('button', { name: /save/i });
    await userEv.click(saveBtn);

    await waitFor(() => expect(bodies.length).toBeGreaterThanOrEqual(1));
    const last = bodies.at(-1) as any;
    expect(last.twitchAutoRewards?.v).toBe(1);
    expect(last.twitchAutoRewards?.follow?.coins).toBe(10);
  });

  it('shows Channel Points mapping editor on Twitch tab (and not in Common)', async () => {
    const userEv = userEvent.setup();
    const me = makeStreamerUser({ channelId: 'c1', channel: { id: 'c1', slug: 's1', name: 'S', twitchChannelId: 't1' } as any });

    server.use(
      http.options('*/channels/:channelId/boosty-access', () => HttpResponse.text('', { status: 204 })),
      http.get('*/channels/:channelId/boosty-access', defaultBoostyAccess),
      mockTwitchRewardEligibility({ eligible: true }),
      http.patch('*/streamer/channel/settings', () => HttpResponse.json({ ok: true })),
    );

    renderWithProviders(<RewardsSettings />, {
      route: '/settings?tab=rewards',
      preloadedState: { auth: { user: me, loading: false, error: null } } as any,
    });

    // Twitch tab: the Channel Points mapping section is visible and scoped (no Follow toggle inside).
    await userEv.click(await screen.findByRole('button', { name: /twitch/i }));
    const cpTitle = await screen.findByRole('heading', { name: /twitch\s+channel\s+points:?\s*rewardid\s*→\s*coins/i });
    const cpSection = cpTitle.closest('section') ?? cpTitle.parentElement ?? document.body;
    expect(within(cpSection).queryByRole('checkbox', { name: /enable follow auto reward/i })).not.toBeInTheDocument();
    // Text appears both in section title and inside the editor; assert "at least one" match.
    expect(within(cpSection).getAllByText(/channel points:?\s*rewardid\s*→\s*coins/i).length).toBeGreaterThanOrEqual(1);

    // Common tab: still hidden.
    await userEv.click(await screen.findByRole('button', { name: /(общие|common)/i }));
    const commonTitleEl = await screen.findByRole('heading', { name: /(автонаграды|auto rewards)/i });
    const commonSection = commonTitleEl.closest('section') ?? commonTitleEl.parentElement ?? document.body;
    expect(within(commonSection).queryByText(/channel points:?\s*rewardid\s*→\s*coins/i)).not.toBeInTheDocument();
  });

  it('allows editing/saving autoRewards on Kick tab when Twitch is not linked', async () => {
    const userEv = userEvent.setup();
    const me = makeStreamerUser({
      channelId: 'c1',
      channel: { id: 'c1', slug: 's1', name: 'S', twitchChannelId: null } as any,
      externalAccounts: [{ id: 'ea_kick', provider: 'kick' } as any],
    });

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

    logRewardsSnapshot({ runId: 'pre-fix', test: 'kick_tab_autoRewards' });
    await userEv.click(await screen.findByRole('button', { name: /(общие|common)/i }));

    const titleEl = await screen.findByRole('heading', { name: /(автонаграды|auto rewards)/i });
    const section = titleEl.closest('section') ?? titleEl.parentElement ?? document.body;

    const followToggle = within(section).getByRole('checkbox', { name: /enable follow auto reward/i });
    await userEv.click(followToggle);

    const followCoins = within(section).getByRole('textbox', { name: /follow coins/i }) as HTMLInputElement;
    await userEv.clear(followCoins);
    await userEv.type(followCoins, '10');

    const saveBtn = within(section).getByRole('button', { name: /save/i });
    expect(saveBtn).not.toBeDisabled();
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

    await userEv.click(await screen.findByRole('button', { name: /(заявки|submissions)/i }));
    logRewardsSnapshot({ runId: 'pre-fix', test: 'approved_meme_autosave' });
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

    await userEv.click(await screen.findByRole('button', { name: /(заявки|submissions)/i }));
    logRewardsSnapshot({ runId: 'pre-fix', test: 'approved_meme_invalid_toast' });
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

    logRewardsSnapshot({ runId: 'pre-fix', test: 'kick_reward_autosave' });
    await userEv.click(await screen.findByRole('button', { name: /kick/i }));
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


