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
});
