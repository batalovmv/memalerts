import { describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/lib/userPreferences', () => ({
  clearUserPreferencesCache: vi.fn(),
}));

import reducer, { fetchUser, setUnauthenticated, updateWalletBalance } from './authSlice';

import type { User } from '@/types';

describe('authSlice reducer', () => {
  it('has expected initial state', () => {
    const state = reducer(undefined, { type: 'init' });
    expect(state).toEqual({ user: null, loading: true, error: null });
  });

  it('setUnauthenticated clears user and loading and error', async () => {
    const user: User = {
      id: 'u1',
      displayName: 'User',
      role: 'viewer',
      channelId: null,
    };
    const prev = { user, loading: true, error: 'x' };

    const next = reducer(prev, setUnauthenticated());
    expect(next.user).toBeNull();
    expect(next.loading).toBe(false);
    expect(next.error).toBeNull();

    const { clearUserPreferencesCache } = await import('@/shared/lib/userPreferences');
    expect(clearUserPreferencesCache).toHaveBeenCalledTimes(1);
  });

  it('updateWalletBalance creates wallets array and adds wallet if missing', () => {
    const user: User = {
      id: 'u1',
      displayName: 'User',
      role: 'viewer',
      channelId: 'c0',
      wallets: undefined,
    };
    const prev = { user, loading: false, error: null };

    const next = reducer(prev, updateWalletBalance({ channelId: 'c1', balance: 123 }));
    expect(next.user?.wallets?.length).toBe(1);
    expect(next.user?.wallets?.[0]).toMatchObject({
      userId: 'u1',
      channelId: 'c1',
      balance: 123,
    });
  });

  it('updateWalletBalance updates existing wallet balance', () => {
    const user: User = {
      id: 'u1',
      displayName: 'User',
      role: 'viewer',
      channelId: 'c0',
      wallets: [{ id: 'w1', userId: 'u1', channelId: 'c1', balance: 10 }],
    };
    const prev = { user, loading: false, error: null };

    const next = reducer(prev, updateWalletBalance({ channelId: 'c1', balance: 999 }));
    expect(next.user?.wallets?.length).toBe(1);
    expect(next.user?.wallets?.[0]?.balance).toBe(999);
  });

  it('fetchUser.rejected stores message from payload', () => {
    const prev = reducer(undefined, { type: 'init' });
    const next = reducer(
      prev,
      fetchUser.rejected(new Error('boom') as any, 'req1', undefined, { message: 'Nope', statusCode: 500 } as any),
    );
    expect(next.loading).toBe(false);
    expect(next.user).toBeNull();
    expect(next.error).toBe('Nope');
  });
});













