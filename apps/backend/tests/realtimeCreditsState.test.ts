vi.mock('../src/utils/redisClient.js', () => ({
  getRedisClient: vi.fn(),
  getRedisNamespace: vi.fn(),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'socket.io';

import * as creditsState from '../src/realtime/creditsState.js';
import {
  addCreditsChatter,
  addCreditsDonor,
  getCreditsStateFromStore,
  markCreditsSessionOffline,
  resetCreditsSession,
  startOrResumeCreditsSession,
} from '../src/realtime/creditsSessionStore.js';
import { getRedisClient, getRedisNamespace } from '../src/utils/redisClient.js';

type HashStore = Map<string, Map<string, string>>;
type ZSetStore = Map<string, Map<string, number>>;

function createMockRedis() {
  const hashes: HashStore = new Map();
  const zsets: ZSetStore = new Map();

  return {
    hSet: vi.fn(async (key: string, fieldOrMap: string | Record<string, string>, value?: string) => {
      const map = hashes.get(key) ?? new Map<string, string>();
      if (typeof fieldOrMap === 'string') {
        map.set(fieldOrMap, String(value ?? ''));
      } else {
        for (const [field, val] of Object.entries(fieldOrMap)) {
          map.set(field, String(val));
        }
      }
      hashes.set(key, map);
      return 0;
    }),
    hGetAll: vi.fn(async (key: string) => {
      const map = hashes.get(key);
      if (!map) return {};
      const out: Record<string, string> = {};
      for (const [field, val] of map.entries()) {
        out[field] = val;
      }
      return out;
    }),
    hmGet: vi.fn(async (key: string, fields: string[]) => {
      const map = hashes.get(key);
      return fields.map((field) => map?.get(field) ?? null);
    }),
    zAdd: vi.fn(async (key: string, entries: Array<{ score: number; value: string }>, opts?: { NX?: boolean }) => {
      const map = zsets.get(key) ?? new Map<string, number>();
      for (const entry of entries) {
        if (opts?.NX && map.has(entry.value)) continue;
        map.set(entry.value, entry.score);
      }
      zsets.set(key, map);
      return 0;
    }),
    zRange: vi.fn(async (key: string, start: number, stop: number) => {
      const map = zsets.get(key);
      if (!map) return [];
      const sorted = [...map.entries()].sort((a, b) => a[1] - b[1]);
      const values = sorted.map(([value]) => value);
      const end = stop < 0 ? values.length - 1 : stop;
      return values.slice(start, end + 1);
    }),
    expire: vi.fn(async () => 1),
    del: vi.fn(async (keys: string[] | string) => {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) {
        hashes.delete(key);
        zsets.delete(key);
      }
      return list.length;
    }),
  };
}

describe('realtime credits state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRedisNamespace).mockReturnValue('test');
    const mockRedis = createMockRedis();
    vi.mocked(getRedisClient).mockResolvedValue(mockRedis as unknown as Awaited<ReturnType<typeof getRedisClient>>);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts, resumes, and resets credits sessions', async () => {
    const first = await startOrResumeCreditsSession('Credits-Channel', 10);
    expect(first.resumed).toBe(false);
    expect(first.sessionId).toBeTruthy();

    await markCreditsSessionOffline('Credits-Channel', 10);

    const resumed = await startOrResumeCreditsSession('credits-channel', 10);
    expect(resumed.resumed).toBe(true);
    expect(resumed.sessionId).toBe(first.sessionId);

    const reset = await resetCreditsSession('Credits-Channel', 10);
    expect(reset.sessionId).toBeTruthy();
    expect(reset.sessionId).not.toBe(first.sessionId);
  });

  it('stores chatters and donors and emits credits state', async () => {
    await startOrResumeCreditsSession('Credits-State', 5);
    await addCreditsChatter('Credits-State', 'user-1', 'Alice', 'https://example.com/a.png', 5);
    await addCreditsChatter('Credits-State', 'user-2', 'Bob', 'ftp://invalid', 5);
    await addCreditsDonor('Credits-State', 'Donor', 25, 'usd', 'https://example.com/d.png', 5);

    const state = await getCreditsStateFromStore('credits-state');
    expect(state.chatters).toHaveLength(2);
    expect(state.chatters).toEqual(
      expect.arrayContaining([
        { name: 'Alice', avatarUrl: 'https://example.com/a.png' },
        { name: 'Bob', avatarUrl: null },
      ])
    );
    expect(state.donors).toEqual([
      { name: 'Donor', amount: 25, currency: 'USD', avatarUrl: 'https://example.com/d.png' },
    ]);

    const calls: Array<{ room: string; event: string; payload: unknown }> = [];
    const fakeIo = {
      to(room: string) {
        return {
          emit(event: string, payload: unknown) {
            calls.push({ room, event, payload });
          },
        };
      },
    } as unknown as Server;

    await creditsState.emitCreditsState(fakeIo, 'CREDITS-STATE');

    expect(calls).toHaveLength(1);
    expect(calls[0].room).toBe('channel:credits-state');
    expect(calls[0].event).toBe('credits:state');
    expect(calls[0].payload).toEqual(state);
  });

  it('ticks credits state and honors ref counting', async () => {
    vi.useFakeTimers();
    const calls: Array<{ room: string; event: string; payload: unknown }> = [];
    const fakeIo = {
      to(room: string) {
        return {
          emit(event: string, payload: unknown) {
            calls.push({ room, event, payload });
          },
        };
      },
    } as unknown as Server;

    await startOrResumeCreditsSession('Ticker', 5);
    await addCreditsChatter('Ticker', 'user-1', 'Alice', null, 5);

    creditsState.startCreditsTicker(fakeIo, 'Ticker', 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1);
    expect(calls[0].event).toBe('credits:state');

    creditsState.startCreditsTicker(fakeIo, 'ticker', 1000);
    creditsState.stopCreditsTicker('TICKER');
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(2);

    creditsState.stopCreditsTicker('ticker');
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(2);
  });
});
