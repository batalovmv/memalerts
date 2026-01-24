import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import type { PreloadedState } from '@reduxjs/toolkit';

import { createTestStore } from '@/test/test-utils';
import { fetchUser, setUnauthenticated } from '@/store/slices/authSlice';
import type { RootState } from '@/store';
import type { Submission, User, Wallet } from '@/types';

type Listener = (...args: unknown[]) => void;
type EmittedEvent = { event: string; args: unknown[] };

class FakeSocket {
  public connected = false;
  public listeners = new Map<string, Set<Listener>>();
  public emitted: EmittedEvent[] = [];
  public disconnected = 0;
  public connectCalls = 0;

  on(event: string, cb: Listener) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(cb);
    this.listeners.set(event, set);
    return this;
  }

  off(event: string, cb: Listener) {
    const set = this.listeners.get(event);
    set?.delete(cb);
    return this;
  }

  emit(event: string, ...args: unknown[]) {
    this.emitted.push({ event, args });
    return this;
  }

  disconnect() {
    this.disconnected += 1;
    this.connected = false;
    return this;
  }

  connect() {
    this.connectCalls += 1;
    return this;
  }

  fire(event: string, ...args: unknown[]) {
    const set = this.listeners.get(event) ?? new Set();
    for (const cb of set) cb(...args);
  }
}

function makePreloadedState(state: PreloadedState<RootState>) {
  return state;
}

function makeViewerUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    displayName: 'User',
    role: 'viewer',
    channelId: null,
    ...overrides,
  };
}

function makeStreamerUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    displayName: 'User',
    role: 'streamer',
    channelId: 'c1',
    channel: { id: 'c1', slug: 'streamer', name: 'Streamer' },
    ...overrides,
  };
}

describe('SocketProvider (realtime)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('does not create socket while auth user is null (loading)', async () => {
    const ioMock = vi.fn(() => new FakeSocket());
    vi.doMock('socket.io-client', () => ({ io: ioMock }));

    const { SocketProvider: ProviderImpl } = await import('./SocketContext');

    const store = createTestStore(
      makePreloadedState({
        auth: { user: null, loading: true, error: null },
      }),
    );

    render(
      <Provider store={store}>
        <ProviderImpl>
          <div>Child</div>
        </ProviderImpl>
      </Provider>,
    );

    expect(ioMock).not.toHaveBeenCalled();
  });

  it('creates socket and joins user room on connect', async () => {
    const s = new FakeSocket();
    const ioMock = vi.fn(() => s);

    vi.doMock('socket.io-client', () => ({ io: ioMock }));
    vi.doMock('../lib/runtimeConfig', () => ({
      getRuntimeConfig: () => ({
        socketUrl: 'http://socket.example',
        socketTransports: ['websocket'],
        socketAllowPollingFallback: true,
      }),
    }));

    const { SocketProvider: ProviderImpl } = await import('./SocketContext');

    const store = createTestStore(
      makePreloadedState({ auth: { user: null, loading: true, error: null } }),
    );
    render(
      <Provider store={store}>
        <ProviderImpl>
          <div>Child</div>
        </ProviderImpl>
      </Provider>,
    );

    // Auth becomes loaded.
    await act(async () => {
      const user = makeViewerUser();
      store.dispatch(fetchUser.fulfilled(user, 'req', undefined));
    });

    expect(ioMock).toHaveBeenCalledTimes(1);
    expect(ioMock.mock.calls[0]?.[0]).toBe('http://socket.example');
    expect(ioMock.mock.calls[0]?.[1]).toMatchObject({ transports: ['websocket'], withCredentials: true });

    // Simulate socket connect -> should emit join:user.
    act(() => {
      s.connected = true;
      s.fire('connect');
    });

    expect(s.emitted.some((e) => e.event === 'join:user' && e.args[0] === 'u1')).toBe(true);
  });

  it('joins channel room for streamer users', async () => {
    const s = new FakeSocket();
    const ioMock = vi.fn(() => s);

    vi.doMock('socket.io-client', () => ({ io: ioMock }));
    vi.doMock('../lib/runtimeConfig', () => ({ getRuntimeConfig: () => ({ socketUrl: 'http://socket.example' }) }));

    const { SocketProvider: ProviderImpl } = await import('./SocketContext');

    const store = createTestStore(
      makePreloadedState({
        auth: {
          user: makeStreamerUser(),
          loading: false,
          error: null,
        },
      }),
    );

    render(
      <Provider store={store}>
        <ProviderImpl>
          <div>Child</div>
        </ProviderImpl>
      </Provider>,
    );

    act(() => {
      s.connected = true;
      s.fire('connect');
    });

    expect(
      s.emitted.some((e) => e.event === 'join:channel' && e.args[0]?.channelSlug === 'streamer'),
    ).toBe(true);
  });

  it('on connect_error with websocket-only and polling fallback allowed, re-inits with polling', async () => {
    const s1 = new FakeSocket();
    const s2 = new FakeSocket();
    const ioMock = vi.fn()
      .mockImplementationOnce(() => s1)
      .mockImplementationOnce(() => s2);

    vi.doMock('socket.io-client', () => ({ io: ioMock }));
    vi.doMock('../lib/runtimeConfig', () => ({
      getRuntimeConfig: () => ({
        socketUrl: 'http://socket.example',
        socketTransports: ['websocket'],
        socketAllowPollingFallback: true,
      }),
    }));

    const { SocketProvider: ProviderImpl } = await import('./SocketContext');

    const store = createTestStore(
      makePreloadedState({
        auth: { user: makeViewerUser(), loading: false, error: null },
      }),
    );

    render(
      <Provider store={store}>
        <ProviderImpl>
          <div>Child</div>
        </ProviderImpl>
      </Provider>,
    );

    expect(ioMock).toHaveBeenCalledTimes(1);
    expect(ioMock.mock.calls[0]?.[1]).toMatchObject({ transports: ['websocket'], forceNew: false });

    act(() => {
      s1.fire('connect_error', new Error('boom'));
    });

    expect(s1.disconnected).toBeGreaterThanOrEqual(1);
    expect(ioMock).toHaveBeenCalledTimes(2);
    expect(ioMock.mock.calls[1]?.[1]).toMatchObject({ transports: ['websocket', 'polling'], forceNew: true });
  });

  it('dispatches updateWalletBalance on wallet:updated for current user', async () => {
    const s = new FakeSocket();
    const ioMock = vi.fn(() => s);

    vi.doMock('socket.io-client', () => ({ io: ioMock }));
    vi.doMock('../lib/runtimeConfig', () => ({ getRuntimeConfig: () => ({ socketUrl: 'http://socket.example' }) }));

    const { SocketProvider: ProviderImpl } = await import('./SocketContext');

    const store = createTestStore(
      makePreloadedState({
        auth: { user: makeViewerUser({ wallets: [] }), loading: false, error: null },
      }),
    );

    render(
      <Provider store={store}>
        <ProviderImpl>
          <div>Child</div>
        </ProviderImpl>
      </Provider>,
    );

    act(() => {
      s.connected = true;
      s.fire('connect');
    });

    act(() => {
      s.fire('wallet:updated', { userId: 'u1', channelId: 'c1', balance: 123 });
    });

    const wallets: Wallet[] = store.getState().auth.user?.wallets ?? [];
    expect(wallets.some((w) => w.channelId === 'c1' && w.balance === 123)).toBe(true);
  });

  it('dispatches submissionCreated on submission:created for streamer channel', async () => {
    const s = new FakeSocket();
    const ioMock = vi.fn(() => s);

    vi.doMock('socket.io-client', () => ({ io: ioMock }));
    vi.doMock('../lib/runtimeConfig', () => ({ getRuntimeConfig: () => ({ socketUrl: 'http://socket.example' }) }));

    const { SocketProvider: ProviderImpl } = await import('./SocketContext');

    const store = createTestStore(
      makePreloadedState({
        auth: {
          user: makeStreamerUser({ channel: undefined }),
          loading: false,
          error: null,
        },
      }),
    );

    render(
      <Provider store={store}>
        <ProviderImpl>
          <div>Child</div>
        </ProviderImpl>
      </Provider>,
    );

    act(() => {
      s.connected = true;
      s.fire('connect');
    });

    act(() => {
      s.fire('submission:created', { submissionId: 's1', channelId: 'c1', submitterId: 'u2' });
    });

    const submissions: Submission[] = store.getState().submissions.submissions;
    expect(submissions.some((item) => item.id === 's1')).toBe(true);
  });

  it('dispatches submissionApproved on submission:status-changed', async () => {
    const s = new FakeSocket();
    const ioMock = vi.fn(() => s);

    vi.doMock('socket.io-client', () => ({ io: ioMock }));
    vi.doMock('../lib/runtimeConfig', () => ({ getRuntimeConfig: () => ({ socketUrl: 'http://socket.example' }) }));

    const { SocketProvider: ProviderImpl } = await import('./SocketContext');

    const seededSubmission: Submission = {
      id: 's1',
      title: 'Test',
      type: 'video',
      fileUrlTemp: '',
      status: 'pending',
      notes: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      submitter: { id: 'u2', displayName: 'Submitter' },
    };

    const store = createTestStore(
      makePreloadedState({
        auth: {
          user: makeStreamerUser({ channel: undefined }),
          loading: false,
          error: null,
        },
        submissions: {
          submissions: [seededSubmission],
          loading: false,
          loadingMore: false,
          error: null,
          lastFetchedAt: null,
          lastErrorAt: null,
          total: 1,
        },
      }),
    );

    render(
      <Provider store={store}>
        <ProviderImpl>
          <div>Child</div>
        </ProviderImpl>
      </Provider>,
    );

    act(() => {
      s.connected = true;
      s.fire('connect');
    });

    act(() => {
      s.fire('submission:status-changed', { submissionId: 's1', status: 'approved', channelId: 'c1' });
    });

    const next = store.getState().submissions;
    expect(next.submissions.some((item) => item.id === 's1')).toBe(false);
    expect(next.total).toBe(0);
  });

  it('disconnects socket when user logs out', async () => {
    const s = new FakeSocket();
    const ioMock = vi.fn(() => s);

    vi.doMock('socket.io-client', () => ({ io: ioMock }));
    vi.doMock('../lib/runtimeConfig', () => ({ getRuntimeConfig: () => ({ socketUrl: 'http://socket.example' }) }));

    const { SocketProvider: ProviderImpl } = await import('./SocketContext');

    const store = createTestStore(
      makePreloadedState({
        auth: { user: makeViewerUser(), loading: false, error: null },
      }),
    );

    render(
      <Provider store={store}>
        <ProviderImpl>
          <div>Child</div>
        </ProviderImpl>
      </Provider>,
    );

    expect(ioMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      store.dispatch(setUnauthenticated());
    });
    expect(s.disconnected).toBeGreaterThanOrEqual(1);
  });
});
