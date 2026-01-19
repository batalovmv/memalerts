import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { ChannelStatistics } from './ChannelStatistics';
import { renderWithProviders } from '@/test/test-utils';
import { server } from '@/test/msw/server';
import { mockStreamerChannelStats } from '@/test/msw/handlers';

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ChannelStatistics (integration)', () => {
  it('loads and renders channel stats (tables + overall cards)', async () => {
    server.use(
      mockStreamerChannelStats({
        daily: [
          { day: new Date(Date.now() - 2 * 86400000).toISOString(), activations: 3, coins: 50 },
          { day: new Date(Date.now() - 1 * 86400000).toISOString(), activations: 5, coins: 80 },
          { day: new Date().toISOString(), activations: 2, coins: 10 },
        ],
        overall: {
          totalActivations: 10,
          totalCoinsSpent: 500,
          totalMemes: 42,
        },
        userSpending: [
          { user: { id: 'u1', displayName: 'Alice' }, activationsCount: 3, totalCoinsSpent: 120 },
        ],
        memePopularity: [
          { meme: { id: 'm1', title: 'Meme A' }, activationsCount: 2, totalCoinsSpent: 80 },
        ],
      }),
    );

    renderWithProviders(<ChannelStatistics />, { route: '/settings?tab=statistics' });

    // Should eventually render table rows from payload.
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Meme A')).toBeInTheDocument();
  });

  it('shows toast.error when stats request fails', async () => {
    server.use(http.get('*/streamer/stats/channel', () => HttpResponse.json({ error: 'Nope' }, { status: 500 })));

    renderWithProviders(<ChannelStatistics />, { route: '/settings?tab=statistics' });

    const toast = (await import('react-hot-toast')).default as unknown as { error: ReturnType<typeof vi.fn> };
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});



















