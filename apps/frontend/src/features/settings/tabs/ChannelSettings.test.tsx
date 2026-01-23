import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { ChannelSettings } from './ChannelSettings';
import { renderWithProviders } from '@/test/test-utils';
import { server } from '@/test/msw/server';
import { mockStreamerChannelSettingsPatch } from '@/test/msw/handlers';
import { makeStreamerUser } from '@/test/fixtures/user';

const setAutoplayMemesEnabled = vi.fn();

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/shared/lib/ensureMinDuration', () => ({
  ensureMinDuration: async () => {},
}));

vi.mock('@/shared/lib/hooks', () => ({
  useAutoplayMemes: () => ({
    autoplayMemesEnabled: true,
    setAutoplayMemesEnabled,
  }),
}));

vi.mock('@/contexts/ChannelColorsContext', () => ({
  useChannelColors: () => ({
    getChannelData: async () => null,
    getCachedChannelData: () => ({
      id: 'c1',
      slug: 's1',
      name: 'S',
      coinPerPointRatio: 1,
      primaryColor: '#111111',
      secondaryColor: '#222222',
      accentColor: '#333333',
    }),
  }),
}));

describe('ChannelSettings (integration)', () => {
  it('autosaves colors via PATCH /streamer/channel/settings (debounced)', async () => {
    const userEv = userEvent.setup();
    const me = makeStreamerUser();

    const bodies: unknown[] = [];
    server.use(mockStreamerChannelSettingsPatch((b) => bodies.push(b)));

    renderWithProviders(<ChannelSettings />, {
      route: '/settings?tab=channel',
      preloadedState: { auth: { user: me, loading: false, error: null } } as any,
    });

    // Initial load comes from cached channel data; should not autosave immediately.
    const primaryInput = (await screen.findByPlaceholderText('#9333ea')) as HTMLInputElement;
    expect(primaryInput.value).toBe('#111111');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    expect(bodies.length).toBe(0);

    await userEv.clear(primaryInput);
    await userEv.type(primaryInput, '#abcdef');

    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });

    await waitFor(() => expect(bodies.length).toBeGreaterThanOrEqual(1));
    const last = bodies.at(-1) as any;
    expect(last.primaryColor).toBe('#abcdef');
    expect(last.secondaryColor).toBe('#222222');
    expect(last.accentColor).toBe('#333333');
  });

  it('shows toast.error when autosave fails', async () => {
    const userEv = userEvent.setup();
    const me = makeStreamerUser();

    server.use(
      http.patch('*/streamer/channel/settings', () => HttpResponse.json({ error: 'Boom' }, { status: 500 })),
    );

    renderWithProviders(<ChannelSettings />, {
      route: '/settings?tab=channel',
      preloadedState: { auth: { user: me, loading: false, error: null } } as any,
    });

    const primaryInput = (await screen.findByPlaceholderText('#9333ea')) as HTMLInputElement;
    expect(primaryInput.value).toBe('#111111');
    await userEv.clear(primaryInput);
    await userEv.type(primaryInput, '#aaaaaa');

    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });

    const toast = (await import('react-hot-toast')).default as unknown as { error: ReturnType<typeof vi.fn> };
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});


