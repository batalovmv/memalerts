import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';

import App from './App';
import { renderWithProviders } from '@/test/test-utils';

// Keep this test focused on auth/session orchestration.
vi.mock('./contexts/SocketContext', () => ({
  SocketProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/shared/ui/GlobalErrorBanner', () => ({
  default: () => null,
}));

vi.mock('@/widgets/footer/Footer', () => ({
  default: () => null,
}));

vi.mock('./pages/Landing', () => ({
  default: () => <div>Landing</div>,
}));

// Prevent automatic fetchUser() from interfering with assertions.
vi.mock('./store/slices/authSlice', async () => {
  const actual = await vi.importActual<typeof import('./store/slices/authSlice')>('./store/slices/authSlice');
  return {
    ...actual,
    fetchUser: () => async () => {},
  };
});

describe('App auth/session orchestration (integration)', () => {
  it('clears auth state when memalerts:auth:unauthorized is dispatched', async () => {
    const { store } = renderWithProviders(<App />, {
      route: '/',
      preloadedState: {
        auth: {
          user: { id: 'u1', displayName: 'User', role: 'viewer', channelId: null } as any,
          loading: false,
          error: null,
        },
      } as any,
    });

    expect(await screen.findByText('Landing')).toBeInTheDocument();
    expect(store.getState().auth.user?.id).toBe('u1');

    act(() => {
      window.dispatchEvent(new CustomEvent('memalerts:auth:unauthorized', { detail: { ts: new Date().toISOString() } }));
    });

    await waitFor(() => expect(store.getState().auth.user).toBeNull());
  });
});

