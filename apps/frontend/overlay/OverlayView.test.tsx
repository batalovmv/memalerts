import { render, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import App from './App';

type Listener = (...args: unknown[]) => void;

class FakeSocket {
  public connected = false;
  public listeners = new Map<string, Set<Listener>>();
  public emitted: Array<{ event: string; args: unknown[] }> = [];
  public disconnected = 0;

  on(event: string, cb: Listener) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(cb);
    this.listeners.set(event, set);
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

  fire(event: string, ...args: unknown[]) {
    const set = this.listeners.get(event) ?? new Set();
    for (const cb of set) cb(...args);
  }
}

const hoisted = vi.hoisted(() => {
  const sockets: FakeSocket[] = [];
  const ioMock = vi.fn(() => {
    const s = new FakeSocket();
    sockets.push(s);
    return s as unknown as object;
  });
  return { sockets, ioMock };
});

vi.mock('socket.io-client', () => ({
  io: hoisted.ioMock,
}));

describe('overlay OverlayView (integration)', () => {
  it('does not connect to sockets in demo mode', () => {
    hoisted.sockets.length = 0;
    hoisted.ioMock.mockClear();

    render(
      <MemoryRouter initialEntries={['/t/tok_1?demo=1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </MemoryRouter>,
    );

    expect(hoisted.ioMock).not.toHaveBeenCalled();
  });

  it('connects and emits join:overlay when token route is used', () => {
    hoisted.sockets.length = 0;
    hoisted.ioMock.mockClear();

    render(
      <MemoryRouter initialEntries={['/t/tok_1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </MemoryRouter>,
    );

    expect(hoisted.ioMock).toHaveBeenCalledTimes(1);
    const s = hoisted.sockets[0]!;

    act(() => {
      s.connected = true;
      s.fire('connect');
    });

    expect(s.emitted.some((e) => e.event === 'join:overlay' && e.args[0]?.token === 'tok_1')).toBe(true);
  });

  it('connects and emits join:channel when slug route is used (back-compat)', () => {
    hoisted.sockets.length = 0;
    hoisted.ioMock.mockClear();

    render(
      <MemoryRouter initialEntries={['/my-channel']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </MemoryRouter>,
    );

    expect(hoisted.ioMock).toHaveBeenCalledTimes(1);
    const s = hoisted.sockets[0]!;

    act(() => {
      s.connected = true;
      s.fire('connect');
    });

    expect(s.emitted.some((e) => e.event === 'join:channel' && e.args[0] === 'my-channel')).toBe(true);
  });

  it('disconnects socket on unmount', () => {
    hoisted.sockets.length = 0;
    hoisted.ioMock.mockClear();

    const r = render(
      <MemoryRouter initialEntries={['/t/tok_1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </MemoryRouter>,
    );

    const s = hoisted.sockets[0]!;
    expect(s.disconnected).toBe(0);
    r.unmount();
    expect(s.disconnected).toBeGreaterThanOrEqual(1);
  });
});


