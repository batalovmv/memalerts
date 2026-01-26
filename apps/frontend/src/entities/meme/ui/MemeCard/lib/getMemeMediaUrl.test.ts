import { describe, expect, it } from 'vitest';

import { getMemeMediaUrl } from './getMemeMediaUrl';
import type { MemeDetail } from '@memalerts/api-contracts';

function makeMeme(overrides: Partial<MemeDetail> = {}): MemeDetail {
  return {
    id: 'm1',
    title: 'Test',
    type: 'video',
    fileUrl: 'https://cdn.example.com/original.webm',
    previewUrl: null,
    variants: [],
    priceCoins: 100,
    durationMs: 1000,
    activationsCount: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
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


