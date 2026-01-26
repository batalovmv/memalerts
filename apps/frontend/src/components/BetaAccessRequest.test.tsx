import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { server } from '@/test/msw/server';
import { renderWithProviders } from '@/test/test-utils';
import { mockBetaRequestOk, mockBetaStatus } from '@/test/msw/handlers';

import type { User } from '@memalerts/api-contracts';
import BetaAccessRequest from './BetaAccessRequest';

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const user: User = {
  id: 'u1',
  displayName: 'User',
  role: 'viewer',
  channelId: null,
};

describe('BetaAccessRequest (integration)', () => {
  it('shows request button when status has no request and user has no access', async () => {
    server.use(
      mockBetaStatus({
        hasAccess: false,
        request: null,
      }),
    );

    renderWithProviders(<BetaAccessRequest />, {
      preloadedState: { auth: { user, loading: false, error: null } },
    });

    // Wait until the loading state resolves.
    expect(await screen.findByRole('heading', { name: /beta access required/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /request beta access/i })).toBeEnabled();
  });

  it('submits request and updates UI to pending', async () => {
    const userEv = userEvent.setup();

    let statusCall = 0;
    server.use(
      http.get('*/beta/status', () => {
        statusCall += 1;
        if (statusCall === 1) return HttpResponse.json({ hasAccess: false, request: null });
        return HttpResponse.json({
          hasAccess: false,
          request: {
            id: 'r1',
            status: 'pending',
            requestedAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
          },
        });
      }),
      mockBetaRequestOk(),
    );

    renderWithProviders(<BetaAccessRequest />, {
      preloadedState: { auth: { user, loading: false, error: null } },
    });

    const btn = await screen.findByRole('button', { name: /request beta access/i });
    await userEv.click(btn);

    // After request, it reloads status and should render "pending" message instead of the request button.
    expect(await screen.findByText(/pending approval/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request beta access/i })).not.toBeInTheDocument();
  });
});


