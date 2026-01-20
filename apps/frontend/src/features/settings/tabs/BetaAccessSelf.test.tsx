import React from 'react';
import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { BetaAccessSelf } from './BetaAccessSelf';
import { renderWithProviders } from '@/test/test-utils';
import { server } from '@/test/msw/server';
import { makeViewerUser } from '@/test/fixtures/user';

describe('BetaAccessSelf (integration)', () => {
  it('requests beta access and then shows pending state', async () => {
    const userEv = userEvent.setup();

    let status: { hasAccess: boolean; request: { status: string } | null } = {
      hasAccess: false,
      request: null,
    };
    const postCalls: string[] = [];

    server.use(
      http.get('*/beta/status', () => HttpResponse.json(status)),
      http.post('*/beta/request', () => {
        postCalls.push('request');
        status = { hasAccess: false, request: { status: 'pending' } };
        return HttpResponse.json({ ok: true });
      }),
    );

    renderWithProviders(<BetaAccessSelf />, {
      route: '/settings?tab=beta',
      preloadedState: { auth: { user: makeViewerUser(), loading: false, error: null } } as any,
    });

    // Initial: not requested -> button exists.
    const btn = await screen.findByRole('button', { name: /request beta access/i });
    await userEv.click(btn);

    expect(postCalls).toEqual(['request']);
    expect(await screen.findByText(/pending approval/i)).toBeInTheDocument();
  });

  it('shows has-access state when already granted', async () => {
    server.use(http.get('*/beta/status', () => HttpResponse.json({ hasAccess: true, request: null })));

    renderWithProviders(<BetaAccessSelf />, {
      route: '/settings?tab=beta',
      preloadedState: { auth: { user: makeViewerUser(), loading: false, error: null } } as any,
    });

    expect(await screen.findByText(/already have beta access/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request beta access/i })).not.toBeInTheDocument();
  });

  it('shows revoked/blacklisted copy when request status is revoked', async () => {
    server.use(http.get('*/beta/status', () => HttpResponse.json({ hasAccess: false, request: { status: 'revoked' } })));

    renderWithProviders(<BetaAccessSelf />, {
      route: '/settings?tab=beta',
      preloadedState: { auth: { user: makeViewerUser(), loading: false, error: null } } as any,
    });

    expect(await screen.findByText(/access denied/i)).toBeInTheDocument();
  });
});


