import { describe, expect, it, vi } from 'vitest';

describe('runtimeConfig (web)', () => {
  it('returns {} when /config.json is not ok', async () => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({ apiBaseUrl: 'NOPE' }) })) as unknown as typeof fetch,
    );

    const { loadRuntimeConfig, getRuntimeConfig } = await import('./runtimeConfig');
    const cfg = await loadRuntimeConfig();

    expect(cfg).toEqual({});
    expect(getRuntimeConfig()).toEqual({});
    expect((window as any).__MEMALERTS_RUNTIME_CONFIG__).toEqual({});
  });

  it('caches the loaded config and does not refetch', async () => {
    vi.resetModules();

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ apiBaseUrl: '', uploadsBaseUrl: 'https://cdn.example' }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { loadRuntimeConfig } = await import('./runtimeConfig');
    const a = await loadRuntimeConfig();
    const b = await loadRuntimeConfig();

    expect(a).toEqual({ apiBaseUrl: '', uploadsBaseUrl: 'https://cdn.example' });
    expect(b).toEqual(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});















