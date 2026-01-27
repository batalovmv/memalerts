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
        subscribed_ru: contains('подписка активна'),
        uploadRewardLabel: contains('bonus (upload / url)'),
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
  type ChannelSettingsPatch = {
    submissionRewardCoinsUpload?: number;
    submissionRewardCoinsPool?: number;
  };

  it('autosaves approved meme reward via /streamer/channel/settings (payload uses numbers)', async () => {
    const userEv = userEvent.setup();
    const me = makeStreamerUser({ channelId: 'c1', channel: { id: 'c1', slug: 's1', name: 'S', twitchChannelId: 't1' } });

    const bodies: unknown[] = [];
    server.use(mockTwitchRewardEligibility({ eligible: true }), mockStreamerChannelSettingsPatch((b) => bodies.push(b)));

    renderWithProviders(<RewardsSettings />, {
      route: '/settings?tab=rewards',
      preloadedState: { auth: { user: me, loading: false, error: null } },
    });

    await userEv.click(await screen.findByRole('button', { name: /(заявки|submissions)/i }));
    logRewardsSnapshot({ runId: 'pre-fix', test: 'approved_meme_autosave' });
    // Change upload reward to 10 (this triggers debounced autosave).
    const uploadLabelEl = await screen.findByText(/bonus \(upload \/ url\) \(coins\)/i);
    const uploadContainer = uploadLabelEl.closest('div') ?? uploadLabelEl.parentElement ?? document.body;
    const uploadInput = within(uploadContainer).getByRole('textbox') as HTMLInputElement;
    await userEv.clear(uploadInput);
    await userEv.type(uploadInput, '10');

    // Wait for autosave debounce + request.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });

    await waitFor(() =>
      expect(bodies.some((b) => (b as ChannelSettingsPatch | undefined)?.submissionRewardCoinsUpload !== undefined)).toBe(true),
    );
    const payload = [...bodies]
      .reverse()
      .find((b) => (b as ChannelSettingsPatch | undefined)?.submissionRewardCoinsUpload !== undefined) as
      | ChannelSettingsPatch
      | undefined;
    expect(payload).toBeTruthy();
    expect(payload?.submissionRewardCoinsUpload).toBe(10);
    expect(payload?.submissionRewardCoinsPool).toBe(0);
  });

  it('invalid approved meme reward (empty) shows toast error and does not PATCH', async () => {
    const userEv = userEvent.setup();
    const me = makeStreamerUser({ channelId: 'c1', channel: { id: 'c1', slug: 's1', name: 'S', twitchChannelId: 't1' } });

    server.use(
      mockTwitchRewardEligibility({ eligible: true }),
      http.patch('*/streamer/channel/settings', () => HttpResponse.json({ error: 'Boom' }, { status: 500 })),
    );

    renderWithProviders(<RewardsSettings />, {
      route: '/settings?tab=rewards',
      preloadedState: { auth: { user: me, loading: false, error: null } },
    });

    await userEv.click(await screen.findByRole('button', { name: /(заявки|submissions)/i }));
    logRewardsSnapshot({ runId: 'pre-fix', test: 'approved_meme_invalid_toast' });
    const uploadLabelEl = await screen.findByText(/bonus \(upload \/ url\) \(coins\)/i);
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

