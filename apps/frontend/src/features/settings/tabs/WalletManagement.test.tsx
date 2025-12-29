import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { WalletManagement } from './WalletManagement';
import { renderWithProviders } from '@/test/test-utils';
import { server } from '@/test/msw/server';
import { mockOwnerWalletAdjustOk, mockOwnerWalletOptions } from '@/test/msw/handlers';

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('WalletManagement (integration)', () => {
  it('loads options, selects first user, loads wallets, and shows current balance for selected pair', async () => {
    const optionsCalls = vi.fn();
    const walletsCalls: URL[] = [];

    server.use(
      mockOwnerWalletOptions(
        {
          users: [
            { id: 'u1', displayName: 'Alice' },
            { id: 'u2', displayName: 'Bob' },
          ],
          channels: [],
        },
        () => optionsCalls(),
      ),
      http.get('*/owner/wallets*', ({ request }) => {
        walletsCalls.push(new URL(request.url));
        return HttpResponse.json({
          items: [
            {
              id: 'w1',
              userId: 'u1',
              channelId: 'c_streamer',
              balance: 10,
              user: { id: 'u1', displayName: 'Alice' },
              channel: { id: 'c_streamer', name: 'Streamer', slug: 'streamer' },
            },
          ],
        });
      }),
    );

    renderWithProviders(<WalletManagement />, { route: '/settings?tab=wallets' });

    // Options should load once.
    await waitFor(() => expect(optionsCalls).toHaveBeenCalledTimes(1));

    // Wallets load for first user.
    await waitFor(() => expect(walletsCalls.length).toBe(1));
    expect(walletsCalls[0]!.searchParams.get('userId')).toBe('u1');

    // Shows selected pair line and balance text.
    expect(await screen.findByText(/alice\s*→\s*streamer/i)).toBeInTheDocument();
    expect(await screen.findByText(/balance.*10 coins/i)).toBeInTheDocument();
  });

  it('adjust validates amount and on success posts /adjust then refreshes wallets', async () => {
    const user = userEvent.setup();

    let balance = 10;
    const walletsCalls: URL[] = [];
    const adjustAssert = vi.fn();

    server.use(
      mockOwnerWalletOptions(
        {
          users: [{ id: 'u1', displayName: 'Alice' }],
          channels: [],
        },
      ),
      http.get('*/owner/wallets*', ({ request }) => {
        walletsCalls.push(new URL(request.url));
        return HttpResponse.json({
          items: [
            {
              id: 'w1',
              userId: 'u1',
              channelId: 'c_streamer',
              balance,
              user: { id: 'u1', displayName: 'Alice' },
              channel: { id: 'c_streamer', name: 'Streamer', slug: 'streamer' },
            },
          ],
        });
      }),
      mockOwnerWalletAdjustOk(({ userId, channelId, amount }) => {
        adjustAssert({ userId, channelId, amount });
        balance += amount;
      }),
    );

    renderWithProviders(<WalletManagement />, { route: '/settings?tab=wallets' });
    await waitFor(() => expect(walletsCalls.length).toBe(1));

    // Empty amount -> error toast, no POST.
    await user.click(screen.getByRole('button', { name: /^adjust$/i }));
    const toast = (await import('react-hot-toast')).default as unknown as { error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn> };
    expect(toast.error).toHaveBeenCalled();
    expect(adjustAssert).not.toHaveBeenCalled();

    // Enter +5 and adjust.
    const amountInput = screen.getByPlaceholderText(/amount/i);
    await user.type(amountInput, '5');
    await user.click(screen.getByRole('button', { name: /^adjust$/i }));

    await waitFor(() => expect(adjustAssert).toHaveBeenCalledWith({ userId: 'u1', channelId: 'c_streamer', amount: 5 }));
    await waitFor(() => expect(walletsCalls.length).toBeGreaterThanOrEqual(2));
    expect(toast.success).toHaveBeenCalled();
    expect(await screen.findByText(/balance.*15 coins/i)).toBeInTheDocument();
  });
});


