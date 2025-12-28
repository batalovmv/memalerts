import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { relayWalletUpdatedToPeer } from '../src/realtime/walletBridge.js';
import { relaySubmissionEventToPeer } from '../src/realtime/submissionBridge.js';

describe('internal relay to peer (fetch)', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('walletBridge relays to peer instance with correct header/url/body', async () => {
    const calls: any[] = [];
    global.fetch = vi.fn(async (url: any, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200 } as any;
    }) as any;

    process.env.PORT = '3001';
    await relayWalletUpdatedToPeer({ userId: 'u1', channelId: 'c1', balance: 10 });

    expect(calls).toHaveLength(1);
    expect(String(calls[0].url)).toBe('http://127.0.0.1:3002/internal/wallet-updated');
    expect(calls[0].options?.method).toBe('POST');
    expect(calls[0].options?.headers?.['x-memalerts-internal']).toBe('wallet-updated');
    const body = JSON.parse(String(calls[0].options?.body || '{}'));
    expect(body).toMatchObject({ userId: 'u1', channelId: 'c1', balance: 10, source: 'relay' });
  });

  it('submissionBridge relays to peer instance with correct header/url/body', async () => {
    const calls: any[] = [];
    global.fetch = vi.fn(async (url: any, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200 } as any;
    }) as any;

    process.env.PORT = '3002';
    await relaySubmissionEventToPeer({
      event: 'submission:created',
      submissionId: 's1',
      channelId: 'c1',
      channelSlug: 'MySlug',
      userIds: ['u1'],
    });

    expect(calls).toHaveLength(1);
    expect(String(calls[0].url)).toBe('http://127.0.0.1:3001/internal/submission-event');
    expect(calls[0].options?.method).toBe('POST');
    expect(calls[0].options?.headers?.['x-memalerts-internal']).toBe('submission-event');
    const body = JSON.parse(String(calls[0].options?.body || '{}'));
    expect(body).toMatchObject({
      event: 'submission:created',
      submissionId: 's1',
      channelId: 'c1',
      channelSlug: 'MySlug',
      userIds: ['u1'],
      source: 'relay',
    });
  });

  it('no peer relay when PORT is not 3001/3002', async () => {
    const calls: any[] = [];
    global.fetch = vi.fn(async (url: any, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200 } as any;
    }) as any;

    process.env.PORT = '9999';
    await relayWalletUpdatedToPeer({ userId: 'u1', channelId: 'c1', balance: 10 });
    await relaySubmissionEventToPeer({ event: 'submission:created', submissionId: 's1', channelId: 'c1', channelSlug: 'x' });

    expect(calls).toHaveLength(0);
  });
});


