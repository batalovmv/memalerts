import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { BetaAccessManagement } from './BetaAccessManagement';
import { renderWithProviders } from '@/test/test-utils';
import { server } from '@/test/msw/server';

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('BetaAccessManagement (integration)', () => {
  it('approves a pending request and refreshes lists', async () => {
    const userEv = userEvent.setup();

    type BetaUser = { id: string; displayName: string; twitchUserId?: string; role?: string };
    type BetaRequest = { id: string; status: string; requestedAt: string; user: BetaUser };
    let requests: BetaRequest[] = [
      {
        id: 'req1',
        status: 'pending',
        requestedAt: new Date().toISOString(),
        user: { id: 'u_req', displayName: 'Requester', twitchUserId: '123' },
      },
    ];
    let granted: BetaUser[] = [];
    let revoked: Array<{ id: string; approvedAt: string; user: BetaUser }> = [];

    server.use(
      http.get('*/owner/beta/requests', () => HttpResponse.json(requests)),
      http.get('*/owner/beta/users', () => HttpResponse.json(granted)),
      http.get('*/owner/beta/users/revoked', () => HttpResponse.json(revoked)),
      http.post('*/owner/beta/requests/:requestId/approve', ({ params }) => {
        const requestId = String(params.requestId ?? '');
        const r = requests.find((x) => x.id === requestId);
        requests = requests.filter((x) => x.id !== requestId);
        if (r?.user) granted = [...granted, { id: r.user.id, displayName: r.user.displayName, twitchUserId: r.user.twitchUserId }];
        return HttpResponse.json({ ok: true });
      }),
    );

    renderWithProviders(<BetaAccessManagement />, { route: '/settings?tab=beta' });

    await screen.findByText('Requester');
    await userEv.click(screen.getByRole('button', { name: /approve/i }));

    const toast = (await import('react-hot-toast')).default as unknown as { success: ReturnType<typeof vi.fn> };
    await waitFor(() => expect(toast.success).toHaveBeenCalled());

    // Requests list should now show empty state.
    expect(await screen.findByText(/no beta access requests/i)).toBeInTheDocument();

    // Granted list should contain the user (and show revoke button).
    expect(await screen.findByText('Requester')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /revoke/i })).toBeInTheDocument();
  });

  it('revokes and restores a granted user (confirm + refresh)', async () => {
    const userEv = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    type BetaUser = { id: string; displayName: string; twitchUserId?: string; role?: string };
    let requests: Array<{ id: string; status: string; requestedAt: string; user: BetaUser }> = [];
    let granted: BetaUser[] = [{ id: 'u1', displayName: 'Alice', twitchUserId: '111', role: 'viewer' }];
    let revoked: Array<{ id: string; approvedAt: string; user: BetaUser }> = [];

    server.use(
      http.get('*/owner/beta/requests', () => HttpResponse.json(requests)),
      http.get('*/owner/beta/users', () => HttpResponse.json(granted)),
      http.get('*/owner/beta/users/revoked', () => HttpResponse.json(revoked)),
      http.post('*/owner/beta/users/:userId/revoke', ({ params }) => {
        const userId = String(params.userId ?? '');
        const u = granted.find((x) => x.id === userId);
        granted = granted.filter((x) => x.id !== userId);
        if (u) revoked = [{ id: `rev-${userId}`, approvedAt: new Date().toISOString(), user: u }, ...revoked];
        return HttpResponse.json({ ok: true });
      }),
      http.post('*/owner/beta/users/:userId/restore', ({ params }) => {
        const userId = String(params.userId ?? '');
        const row = revoked.find((x) => x.user?.id === userId);
        revoked = revoked.filter((x) => x.user?.id !== userId);
        if (row?.user) granted = [row.user, ...granted];
        return HttpResponse.json({ ok: true });
      }),
    );

    renderWithProviders(<BetaAccessManagement />, { route: '/settings?tab=beta' });

    // Revoke
    await screen.findByText('Alice');
    await userEv.click(screen.getByRole('button', { name: /revoke/i }));

    const toast = (await import('react-hot-toast')).default as unknown as { success: ReturnType<typeof vi.fn> };
    await waitFor(() => expect(toast.success).toHaveBeenCalled());

    // Now it should appear in revoked section with Restore.
    expect(await screen.findByText('revoked')).toBeInTheDocument();
    const restoreBtn = await screen.findByRole('button', { name: /restore/i });
    await userEv.click(restoreBtn);

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('granted')).toBeInTheDocument();

    confirmSpy.mockRestore();
  });
});

