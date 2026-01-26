import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

import type { MemeListItem } from '@memalerts/api-contracts';

import { installIntersectionObserverOncePerElement } from '@/test/helpers';
import { renderWithProviders } from '@/test/test-utils';
import { MemeCard } from './MemeCard';

function makeMeme(overrides: Partial<MemeListItem> = {}): MemeListItem {
  return {
    id: 'm1',
    title: 'Preview meme',
    type: 'video',
    previewUrl: 'https://cdn.example.com/preview.mp4',
    variants: [],
    fileUrl: 'https://cdn.example.com/original.webm',
    priceCoins: 100,
    durationMs: 1200,
    activationsCount: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('MemeCard', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined as unknown as void);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders previewUrl for card video when available', async () => {
    const restoreIO = installIntersectionObserverOncePerElement();
    const meme = makeMeme();

    renderWithProviders(<MemeCard meme={meme} onClick={vi.fn()} previewMode="hoverMuted" />);

    await waitFor(() => {
      const video = document.querySelector('video');
      expect(video).not.toBeNull();
    });

    const video = document.querySelector('video');
    expect(video?.getAttribute('src')).toBe('https://cdn.example.com/preview.mp4');

    restoreIO();
  });
});
