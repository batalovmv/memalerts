import { render, act, screen } from '@testing-library/react';
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

describe('overlay CreditsOverlayView (integration)', () => {
  it('renders nothing (transparent) until credits:state provides data, then renders sections', async () => {
    // JSDOM may not provide ResizeObserver; CreditsOverlayView uses it.
    const g = globalThis as unknown as { ResizeObserver?: unknown };
    if (!g.ResizeObserver) {
      g.ResizeObserver = class {
        observe() {}
        disconnect() {}
        unobserve() {}
      };
    }

    hoisted.sockets.length = 0;
    hoisted.ioMock.mockClear();

    render(
      <MemoryRouter initialEntries={['/credits/t/tok_1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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

    // Feed credits state with a donor; component should start rendering.
    act(() => {
      s.fire('credits:state', {
        donors: [{ name: 'Alice', amount: 50, currency: 'USD' }],
        chatters: [{ name: 'Bob' }],
      });
    });

    const donors = await screen.findAllByText('Donors');
    expect(donors.length).toBeGreaterThanOrEqual(1);
    const alice = await screen.findAllByText(/alice/i);
    expect(alice.length).toBeGreaterThanOrEqual(1);
    const chatters = await screen.findAllByText('Chatters');
    expect(chatters.length).toBeGreaterThanOrEqual(1);
    const bob = await screen.findAllByText(/bob/i);
    expect(bob.length).toBeGreaterThanOrEqual(1);
  });
});


