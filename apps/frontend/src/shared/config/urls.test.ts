import { describe, expect, it, vi } from 'vitest';

describe('resolveMediaUrl', () => {
  it('uses s3PublicBaseUrl when uploadsBaseUrl is not set', async () => {
    vi.resetModules();
    window.__MEMALERTS_RUNTIME_CONFIG__ = { s3PublicBaseUrl: 'https://s3.example' };

    const { resolveMediaUrl } = await import('./urls');
    expect(resolveMediaUrl('/uploads/foo.mp4')).toBe('https://s3.example/uploads/foo.mp4');

    delete window.__MEMALERTS_RUNTIME_CONFIG__;
  });

  it('prefers uploadsBaseUrl over s3PublicBaseUrl', async () => {
    vi.resetModules();
    window.__MEMALERTS_RUNTIME_CONFIG__ = {
      uploadsBaseUrl: 'https://cdn.example',
      s3PublicBaseUrl: 'https://s3.example',
    };

    const { resolveMediaUrl } = await import('./urls');
    expect(resolveMediaUrl('/uploads/foo.mp4')).toBe('https://cdn.example/uploads/foo.mp4');

    delete window.__MEMALERTS_RUNTIME_CONFIG__;
  });
});
