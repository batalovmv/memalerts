import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Provider } from 'react-redux';

import PostLogin from './PostLogin';
import { createTestStore } from '@/test/test-utils';
import { makeStreamerUser, makeViewerUser } from '@/test/fixtures/user';

vi.mock('@/components/Header', () => ({
  default: () => null,
}));

vi.mock('@/shared/ui', async () => {
  const actual = await vi.importActual<typeof import('@/shared/ui')>('@/shared/ui');
  return {
    ...actual,
    PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Spinner: () => <div>Spinner</div>,
  };
});

describe('PostLogin routing (integration)', () => {
  beforeEach(() => {
    try {
      localStorage.removeItem('memalerts:lastMode');
    } catch {
      // ignore
    }
  });

  it('redirects streamer/admin to /dashboard when stored mode is streamer', async () => {
    localStorage.setItem('memalerts:lastMode', 'streamer');

    const store = createTestStore({
      auth: {
        user: makeStreamerUser({ id: 'u_streamer' }),
        loading: false,
        error: null,
      },
    });

    renderPostLogin(store, '/post-login');

    expect(await screen.findByText('DashboardDest')).toBeInTheDocument();
  });

  it('redirects viewer (no streamer capability) to /search', async () => {
    const store = createTestStore({
      auth: {
        user: makeViewerUser({ id: 'u_viewer' }),
        loading: false,
        error: null,
      },
    });

    renderPostLogin(store, '/post-login');
    expect(await screen.findByText('SearchDest')).toBeInTheDocument();
  });

  it('shows mode choice when user can be streamer and no stored mode; clicking buttons navigates', async () => {
    const userEv = userEvent.setup();
    const store = createTestStore({
      auth: {
        user: makeStreamerUser({ id: 'u_streamer' }),
        loading: false,
        error: null,
      },
    });

    renderPostLogin(store, '/post-login');

    expect(await screen.findByText(/where do you want to go\\?/i)).toBeInTheDocument();

    await userEv.click(screen.getByRole('button', { name: /streamer dashboard/i }));
    expect(await screen.findByText('DashboardDest')).toBeInTheDocument();
    expect(localStorage.getItem('memalerts:lastMode')).toBe('streamer');
  });
});

function renderPostLogin(store: ReturnType<typeof createTestStore>, route: string) {
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/post-login" element={<PostLogin />} />
          <Route path="/dashboard" element={<div>DashboardDest</div>} />
          <Route path="/search" element={<div>SearchDest</div>} />
          <Route path="/channel/:slug" element={<div>ChannelDest</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}


