import { afterEach, describe, expect, it, vi } from 'vitest';

import * as validation from '../lib/validation';

const t = (key: string) => key;

describe('File validation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects files > 50MB', async () => {
    const largeFile = new File([new ArrayBuffer(51 * 1024 * 1024)], 'big.mp4', { type: 'video/mp4' });
    const result = await validation.validateFile(largeFile, t, async () => 10);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('submit.errors.fileTooLarge');
  });

  it('accepts files <= 50MB', async () => {
    const okFile = new File([new ArrayBuffer(10 * 1024 * 1024)], 'ok.mp4', { type: 'video/mp4' });
    const result = await validation.validateFile(okFile, t, async () => 10);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('uses runtime maxUploadSizeMb when provided', async () => {
    vi.resetModules();
    window.__MEMALERTS_RUNTIME_CONFIG__ = { maxUploadSizeMb: 1 };

    const { validateFile } = await import('../lib/validation');
    const tWithInterpolation = (_key: string, options?: Record<string, unknown>) => {
      const fallback = typeof options?.defaultValue === 'string' ? options.defaultValue : _key;
      if (typeof options?.maxMb === 'number') {
        return fallback.replace('{{maxMb}}', String(options.maxMb));
      }
      return fallback;
    };

    const bigFile = new File([new ArrayBuffer(2 * 1024 * 1024)], 'big.mp4', { type: 'video/mp4' });
    const result = await validateFile(bigFile, tWithInterpolation, async () => 10);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Maximum 1 MB');

    delete window.__MEMALERTS_RUNTIME_CONFIG__;
  });
});
