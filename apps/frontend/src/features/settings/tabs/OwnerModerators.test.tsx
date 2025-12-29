import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { OwnerModerators } from './OwnerModerators';
import { renderWithProviders } from '@/test/test-utils';
import { server } from '@/test/msw/server';
import { mockOwnerModeratorGrantOk, mockOwnerModeratorRevokeOk } from '@/test/msw/handlers';

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/store/slices/authSlice', async () => {
  const actual = await vi.importActual<any>('@/store/slices/authSlice');
  return {
    ...actual,
    fetchUser: vi.fn(() => ({ type: 'auth/fetchUser/mock' })),
  };
});

describe('OwnerModerators (integration)', () => {
  it('loads list and supports grant + revoke flows (ConfirmDialog)', async () => {
    const user = userEvent.setup();

    let items = [
      {
        id: 'g1',
        userId: 'u_mod_1',
        active: true,
        user: { id: 'u_mod_1', displayName: 'Alice' },
      },
    ];

    const grantAssert = vi.fn();
    const revokeAssert = vi.fn();

    server.use(
      http.get('*/owner/moderators', () => HttpResponse.json(items)),
      mockOwnerModeratorGrantOk(({ userId }) => {
        grantAssert({ userId });
        items = [
          ...items,
          { id: 'g2', userId, active: true, user: { id: userId, displayName: 'New mod' } },
        ];
      }),
      mockOwnerModeratorRevokeOk(({ userId }) => {
        revokeAssert({ userId });
        items = items.map((x) => (x.userId === userId ? { ...x, active: false } : x));
      }),
    );

    renderWithProviders(<OwnerModerators />, { route: '/settings?tab=ownerModerators' });

    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText(/active/i)).toBeInTheDocument();

    // Grant via input -> confirm dialog -> confirm.
    await user.type(screen.getByPlaceholderText(/user id/i), 'u_new');
    await user.click(screen.getByRole('button', { name: /^grant$/i }));
    const grantDialog = await screen.findByRole('dialog');
    await user.click(within(grantDialog).getByRole('button', { name: /^grant$/i }));

    await waitFor(() => expect(grantAssert).toHaveBeenCalledWith({ userId: 'u_new' }));
    expect(await screen.findByText('New mod')).toBeInTheDocument();

    // Revoke existing moderator.
    await user.click(screen.getAllByRole('button', { name: /^revoke$/i })[0]!);
    const revokeDialog = await screen.findByRole('dialog');
    await user.click(within(revokeDialog).getByRole('button', { name: /^revoke$/i }));

    await waitFor(() => expect(revokeAssert).toHaveBeenCalledWith({ userId: 'u_mod_1' }));
    expect(await screen.findByText(/revoked/i)).toBeInTheDocument();
  });
});


