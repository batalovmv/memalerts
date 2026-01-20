import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const redisMocks = vi.hoisted(() => {
  const store = new Map<string, Record<string, string>>();
  const client = {
    hGetAll: vi.fn(async (key: string) => store.get(key) || {}),
    hSet: vi.fn(async (key: string, data: Record<string, string>) => {
      store.set(key, { ...data });
    }),
    expire: vi.fn(async () => 1),
  };
  return {
    store,
    client,
    getRedisClient: vi.fn(async () => client),
  };
});

vi.mock('../src/utils/redisClient.js', () => ({
  getRedisClient: redisMocks.getRedisClient,
  getRedisNamespace: vi.fn(() => 'test'),
}));

import {
  getStreamDurationSnapshot,
  getStreamSessionSnapshot,
  handleStreamOffline,
  handleStreamOnline,
} from '../src/realtime/streamDurationStore.js';
import { nsKey } from '../src/utils/redisCache.js';

function metaKey(slug: string) {
  return nsKey('streamDuration', `session:${slug}:meta`);
}

function getStoredMeta(slug: string) {
  const key = metaKey(slug);
  return redisMocks.store.get(key);
}

beforeEach(() => {
  redisMocks.store.clear();
  redisMocks.client.hGetAll.mockClear();
  redisMocks.client.hSet.mockClear();
  redisMocks.client.expire.mockClear();
  redisMocks.getRedisClient.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2024-03-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('streamDurationStore', () => {
  it('creates a new session on stream online with empty state', async () => {
    await handleStreamOnline('Channel', 10);

    const meta = getStoredMeta('channel');
    expect(meta?.status).toBe('online');
    expect(meta?.accumMs).toBe('0');
    expect(meta?.lastOnlineAt).toBe(String(new Date('2024-03-01T00:00:00Z').getTime()));
  });

  it('resumes an offline session within the credit window', async () => {
    const slug = 'channel';
    const key = metaKey(slug);
    const offlineAt = new Date('2024-02-29T23:55:00Z').getTime();
    redisMocks.store.set(key, {
      sessionId: 'session-1',
      status: 'offline',
      sessionStartedAt: String(offlineAt - 60000),
      accumMs: '60000',
      lastOnlineAt: '',
      offlineAt: String(offlineAt),
      updatedAt: String(offlineAt),
    });

    await handleStreamOnline(slug, 10);

    const meta = getStoredMeta(slug);
    expect(meta?.sessionId).toBe('session-1');
    expect(meta?.status).toBe('online');
    expect(meta?.offlineAt).toBe('');
  });

  it('starts a new session when offline gap exceeds credit window', async () => {
    const slug = 'channel';
    const key = metaKey(slug);
    const offlineAt = new Date('2024-02-28T00:00:00Z').getTime();
    redisMocks.store.set(key, {
      sessionId: 'session-old',
      status: 'offline',
      sessionStartedAt: String(offlineAt - 60000),
      accumMs: '120000',
      lastOnlineAt: '',
      offlineAt: String(offlineAt),
      updatedAt: String(offlineAt),
    });

    await handleStreamOnline(slug, 10);

    const meta = getStoredMeta(slug);
    expect(meta?.status).toBe('online');
    expect(meta?.sessionId).not.toBe('session-old');
    expect(meta?.accumMs).toBe('0');
  });

  it('creates offline meta on stream offline if missing', async () => {
    await handleStreamOffline('Channel');

    const meta = getStoredMeta('channel');
    expect(meta?.status).toBe('offline');
    expect(meta?.offlineAt).toBe(String(new Date('2024-03-01T00:00:00Z').getTime()));
  });

  it('accumulates time when transitioning to offline', async () => {
    const slug = 'channel';
    const key = metaKey(slug);
    const lastOnlineAt = new Date('2024-02-29T23:50:00Z').getTime();
    redisMocks.store.set(key, {
      sessionId: 'session-1',
      status: 'online',
      sessionStartedAt: String(lastOnlineAt),
      accumMs: String(5 * 60_000),
      lastOnlineAt: String(lastOnlineAt),
      offlineAt: '',
      updatedAt: String(lastOnlineAt),
    });

    await handleStreamOffline(slug);

    const meta = getStoredMeta(slug);
    expect(meta?.status).toBe('offline');
    expect(Number(meta?.accumMs)).toBe(5 * 60_000 + 10 * 60_000);
  });

  it('returns snapshots with totals', async () => {
    const slug = 'channel';
    const key = metaKey(slug);
    const lastOnlineAt = new Date('2024-02-29T23:58:00Z').getTime();
    redisMocks.store.set(key, {
      sessionId: 'session-xyz',
      status: 'online',
      sessionStartedAt: String(lastOnlineAt),
      accumMs: String(3 * 60_000),
      lastOnlineAt: String(lastOnlineAt),
      offlineAt: '',
      updatedAt: String(lastOnlineAt),
    });

    const duration = await getStreamDurationSnapshot(slug);
    const session = await getStreamSessionSnapshot(slug);

    expect(duration).toEqual({ status: 'online', totalMinutes: 5 });
    expect(session).toEqual({ status: 'online', totalMinutes: 5, sessionId: 'session-xyz' });
  });

  it('returns zeroed snapshots when slug is empty', async () => {
    const duration = await getStreamDurationSnapshot('');
    const session = await getStreamSessionSnapshot('   ');

    expect(duration).toEqual({ status: 'offline', totalMinutes: 0 });
    expect(session).toEqual({ status: 'offline', totalMinutes: 0, sessionId: null });
  });
});
