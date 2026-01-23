import { describe, expect, it } from 'vitest';

import { getMemeMediaUrl } from './getMemeMediaUrl';
import type { Meme } from '@/types';

function makeMeme(overrides: Partial<Meme> = {}): Meme {
  return {
    id: 'm1',
    title: 'Test',
    type: 'video',
    fileUrl: 'https://cdn.example.com/original.webm',
    priceCoins: 100,
    durationMs: 1000,
    ...overrides,
  };
}

describe('getMemeMediaUrl', () => {
  it('prefers previewUrl when available', () => {
    const meme = makeMeme({
      previewUrl: 'https://cdn.example.com/preview.mp4',
      playFileUrl: 'https://cdn.example.com/normalized.webm',
    });
    expect(getMemeMediaUrl(meme)).toBe('https://cdn.example.com/preview.mp4');
  });

  it('prefers variants when previewUrl is missing', () => {
    const meme = makeMeme({
      variants: [
        {
          format: 'webm',
          fileUrl: 'https://cdn.example.com/normalized.webm',
          sourceType: 'video/webm',
          fileSizeBytes: 123,
        },
      ],
    });
    expect(getMemeMediaUrl(meme)).toBe('https://cdn.example.com/normalized.webm');
  });

  it('falls back to fileUrl when variants are missing', () => {
    const meme = makeMeme();
    expect(getMemeMediaUrl(meme)).toBe('https://cdn.example.com/original.webm');
  });
});
