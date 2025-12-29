import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, act, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import App from './App';

type Listener = (...args: any[]) => void;

class FakeSocket {
  public connected = false;
  public listeners = new Map<string, Set<Listener>>();
  public emitted: Array<{ event: string; args: any[] }> = [];
  public disconnected = 0;

  on(event: string, cb: Listener) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(cb);
    this.listeners.set(event, set);
    return this;
  }

  emit(event: string, ...args: any[]) {
    this.emitted.push({ event, args });
    return this;
  }

  disconnect() {
    this.disconnected += 1;
    this.connected = false;
    return this;
  }

  fire(event: string, ...args: any[]) {
    const set = this.listeners.get(event) ?? new Set();
    for (const cb of set) cb(...args);
  }
}

const hoisted = vi.hoisted(() => {
  const sockets: FakeSocket[] = [];
  const ioMock = vi.fn(() => {
    const s = new FakeSocket();
    sockets.push(s);
    return s as any;
  });
  return { sockets, ioMock };
});

vi.mock('socket.io-client', () => ({
  io: hoisted.ioMock,
}));

describe('overlay CreditsOverlayView (integration)', () => {
  it('renders nothing (transparent) until credits:state provides data, then renders sections', async () => {
    // JSDOM may not provide ResizeObserver; CreditsOverlayView uses it.
    if (!(globalThis as any).ResizeObserver) {
      (globalThis as any).ResizeObserver = class {
        observe() {}
        disconnect() {}
        unobserve() {}
      };
    }

    hoisted.sockets.length = 0;
    hoisted.ioMock.mockClear();

    render(
      <MemoryRouter initialEntries={['/credits/t/tok_1']}>
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


