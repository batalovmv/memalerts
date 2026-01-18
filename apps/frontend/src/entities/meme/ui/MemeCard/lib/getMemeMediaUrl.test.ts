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
  it('prefers playFileUrl when available', () => {
    const meme = makeMeme({ playFileUrl: 'https://cdn.example.com/normalized.webm' });
    expect(getMemeMediaUrl(meme)).toBe('https://cdn.example.com/normalized.webm');
  });

  it('falls back to fileUrl when playFileUrl is missing', () => {
    const meme = makeMeme();
    expect(getMemeMediaUrl(meme)).toBe('https://cdn.example.com/original.webm');
  });
});
