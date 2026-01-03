import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { AccountsSettings } from './AccountsSettings';
import { renderWithProviders } from '@/test/test-utils';
import { server } from '@/test/msw/server';
import { mockAuthAccountDeleteOk, mockAuthAccounts } from '@/test/msw/handlers';

vi.mock('@/shared/auth/useAuthQueryErrorToast', () => ({
  useAuthQueryErrorToast: () => {},
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('AccountsSettings (integration)', () => {
  beforeEach(() => {
    try {
      sessionStorage.removeItem('memalerts:accountsSettings:lastRefreshAt');
    } catch {
      // ignore
    }
  });

  it('disconnects a linked external account (DELETE /auth/accounts/:id) and refreshes /me', async () => {
    const userEv = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    let me: any = {
      id: 'u1',
      displayName: 'User',
      role: 'viewer',
      channelId: null,
      externalAccounts: [{ id: 'acc_yt', provider: 'youtube', login: 'myyt' }],
    };

    const deleteAssert = vi.fn();
    let meCalls = 0;

    server.use(
      mockAuthAccounts({ accounts: me.externalAccounts }),
      mockAuthAccountDeleteOk(({ id }) => {
        deleteAssert({ id });
        me = { ...me, externalAccounts: [] };
      }),
      http.get('*/me', () => {
        meCalls += 1;
        return HttpResponse.json(me);
      }),
    );

    renderWithProviders(<AccountsSettings />, {
      route: '/settings/accounts',
      preloadedState: { auth: { user: me, loading: false, error: null } } as any,
    });

    // Linked indicator should show for the YouTube row.
    const ytLogin = await screen.findByText(/@myyt/i);
    const ytCard = ytLogin.closest('.surface') as HTMLElement | null;
    expect(ytCard).not.toBeNull();
    expect(within(ytCard!).getByText(/connected/i)).toBeInTheDocument();

    // Disconnect (confirm -> delete).
    await userEv.click(within(ytCard!).getByRole('button', { name: /disconnect/i }));

    await waitFor(() => expect(deleteAssert).toHaveBeenCalledWith({ id: 'acc_yt' }));
    await waitFor(() => expect(meCalls).toBeGreaterThanOrEqual(1));

    const toast = (await import('react-hot-toast')).default as unknown as { success: ReturnType<typeof vi.fn> };
    expect(toast.success).toHaveBeenCalled();

    confirmSpy.mockRestore();
  });
});








