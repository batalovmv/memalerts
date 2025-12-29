import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import reducer, { fetchUser, logout } from './authSlice';
import { createTestStore } from '@/test/test-utils';
import { server } from '@/test/msw/server';

vi.mock('@/shared/lib/userPreferences', () => ({
  clearUserPreferencesCache: vi.fn(),
}));

describe('authSlice thunks (integration via MSW)', () => {
  afterEach(async () => {
    // `api.get()` removes its pending dedup entry via setTimeout(..., 0) in test mode.
    // Yield one tick so the cleanup runs before the next test starts (prevents promise reuse across tests).
    await new Promise((r) => setTimeout(r, 0));
  });

  it('fetchUser() loads /me and stores user on success', async () => {
    server.use(
      http.get('*/me', () =>
        HttpResponse.json({
          id: 'u1',
          displayName: 'User',
          role: 'viewer',
          channelId: null,
        }),
      ),
    );

    const store = createTestStore();
    await store.dispatch(fetchUser() as any);

    const s = store.getState().auth;
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
    expect(s.user).toMatchObject({ id: 'u1', displayName: 'User', role: 'viewer' });
  });

  it('fetchUser() stores error message on failure', async () => {
    server.use(http.get('*/me', () => HttpResponse.json({ error: 'Nope' }, { status: 500 })));

    const store = createTestStore();
    await store.dispatch(fetchUser() as any);

    const s = store.getState().auth;
    expect(s.loading).toBe(false);
    expect(s.user).toBeNull();
    expect(s.error).toBeTruthy();
    expect(String(s.error)).toMatch(/500|failed/i);
  });

  it('logout() calls /auth/logout and clears user + preferences cache on success', async () => {
    const calls: Array<{ method: string; path: string }> = [];
    server.use(
      http.post('*/auth/logout', ({ request }) => {
        calls.push({ method: request.method, path: new URL(request.url).pathname });
        return HttpResponse.json({ ok: true });
      }),
    );

    const store = createTestStore({
      auth: {
        user: { id: 'u1', displayName: 'User', role: 'viewer', channelId: null } as any,
        loading: false,
        error: null,
      },
    } as any);

    await store.dispatch(logout() as any);

    expect(calls).toEqual([{ method: 'POST', path: '/auth/logout' }]);
    const s = store.getState().auth;
    expect(s.user).toBeNull();
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();

    const { clearUserPreferencesCache } = await import('@/shared/lib/userPreferences');
    expect(clearUserPreferencesCache).toHaveBeenCalledTimes(1);
  });

  it('logout.fulfilled clears userPreferencesCache even when reducer is invoked directly', async () => {
    const prev = reducer(
      {
        user: { id: 'u1', displayName: 'User', role: 'viewer', channelId: null } as any,
        loading: true,
        error: 'x',
      },
      { type: 'init' } as any,
    );

    const next = reducer(prev, logout.fulfilled(undefined, 'req1', undefined));
    expect(next.user).toBeNull();
    expect(next.loading).toBe(false);
    expect(next.error).toBeNull();

    const { clearUserPreferencesCache } = await import('@/shared/lib/userPreferences');
    expect(clearUserPreferencesCache).toHaveBeenCalledTimes(1);
  });
});


