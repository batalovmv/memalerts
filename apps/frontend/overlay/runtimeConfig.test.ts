import { describe, expect, it, vi } from 'vitest';

describe('runtimeConfig (overlay)', () => {
  it('returns {} when fetch throws', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network');
    }) as unknown as typeof fetch);

    const { loadRuntimeConfig, getRuntimeConfig } = await import('./runtimeConfig');
    const cfg = await loadRuntimeConfig();

    expect(cfg).toEqual({});
    expect(getRuntimeConfig()).toEqual({});
  });
});












