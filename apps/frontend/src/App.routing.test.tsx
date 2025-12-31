import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { useParams } from 'react-router-dom';

import App from './App';
import { renderWithProviders } from '@/test/test-utils';

vi.mock('./contexts/SocketContext', () => ({
  SocketProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./components/GlobalErrorBanner', () => ({ default: () => null }));
vi.mock('./components/Footer', () => ({ default: () => null }));

// Avoid network and unrelated flows for these routing tests.
vi.mock('./store/slices/authSlice', async () => {
  const actual = await vi.importActual<typeof import('./store/slices/authSlice')>('./store/slices/authSlice');
  return { ...actual, fetchUser: () => async () => {} };
});

vi.mock('./pages/Dashboard', () => ({ default: () => <div>DashboardPage</div> }));
vi.mock('./pages/Search', () => ({ default: () => <div>SearchPage</div> }));
vi.mock('./pages/Admin', () => ({ default: () => <div>AdminPage</div> }));
vi.mock('./pages/Landing', () => ({ default: () => <div>LandingPage</div> }));
vi.mock('./pages/StreamerProfile', () => ({
  default: () => {
    const { slug } = useParams();
    return <div>ChannelPage:{slug}</div>;
  },
}));
vi.mock('./pages/PostLogin', () => ({ default: () => <div>PostLoginPage</div> }));

describe('App routing (integration)', () => {
  it('redirects viewer from /dashboard to viewerHome (sessionStorage)', async () => {
    sessionStorage.setItem('memalerts:viewer:home', '/channel/test-channel');

    renderWithProviders(<App />, {
      route: '/dashboard',
      preloadedState: {
        auth: { user: { id: 'u1', displayName: 'Viewer', role: 'viewer', channelId: null } as any, loading: false, error: null },
      } as any,
    });

    expect(await screen.findByText('ChannelPage:test-channel')).toBeInTheDocument();
  });

  it('redirects viewer from /dashboard to /search when no viewerHome and no own channel slug', async () => {
    sessionStorage.removeItem('memalerts:viewer:home');

    renderWithProviders(<App />, {
      route: '/dashboard',
      preloadedState: {
        auth: { user: { id: 'u1', displayName: 'Viewer', role: 'viewer', channelId: null } as any, loading: false, error: null },
      } as any,
    });

    expect(await screen.findByText('SearchPage')).toBeInTheDocument();
  });

  it('renders dashboard for streamer/admin at /dashboard', async () => {
    sessionStorage.removeItem('memalerts:viewer:home');

    renderWithProviders(<App />, {
      route: '/dashboard',
      preloadedState: {
        auth: {
          user: { id: 'u_streamer', displayName: 'Streamer', role: 'streamer', channelId: 'c1', channel: { id: 'c1', slug: 's1', name: 'S' } } as any,
          loading: false,
          error: null,
        },
      } as any,
    });

    expect(await screen.findByText('DashboardPage')).toBeInTheDocument();
  });

  it('redirects viewer from /admin to viewerHome', async () => {
    sessionStorage.setItem('memalerts:viewer:home', '/channel/someone');

    renderWithProviders(<App />, {
      route: '/admin',
      preloadedState: {
        auth: { user: { id: 'u1', displayName: 'Viewer', role: 'viewer', channelId: null } as any, loading: false, error: null },
      } as any,
    });

    expect(await screen.findByText('ChannelPage:someone')).toBeInTheDocument();
  });

  it('routes /settings/* to Admin page container', async () => {
    renderWithProviders(<App />, {
      route: '/settings/accounts',
      preloadedState: {
        auth: { user: { id: 'u1', displayName: 'Viewer', role: 'viewer', channelId: null } as any, loading: false, error: null },
      } as any,
    });

    expect(await screen.findByText('AdminPage')).toBeInTheDocument();
  });
});











