import { describe, expect, it, vi } from 'vitest';

import type { Meme } from '@/types';

import { renderWithProviders } from '@/test/test-utils';
import MemeModal from './MemeModal';

function makeMeme(overrides: Partial<Meme> = {}): Meme {
  return {
    id: 'm1',
    title: 'Test meme',
    type: 'video',
    fileUrl: 'https://cdn.example.com/original.mp4',
    priceCoins: 10,
    durationMs: 1200,
    ...overrides,
  };
}

describe('MemeModal', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined as unknown as void);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers playFileUrl when available', () => {
    const onClose = vi.fn();
    const onUpdate = vi.fn();
    const meme = makeMeme({ playFileUrl: 'https://cdn.example.com/play.mp4' });

    renderWithProviders(
      <MemeModal meme={meme} isOpen onClose={onClose} onUpdate={onUpdate} isOwner={false} mode="viewer" />,
      { preloadedState: { auth: { user: null, loading: false, error: null } } },
    );

    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe('https://cdn.example.com/play.mp4');
  });

  it('keeps preview in the modal and preloads full metadata', () => {
    const onClose = vi.fn();
    const onUpdate = vi.fn();
    const meme = makeMeme({
      previewUrl: 'https://cdn.example.com/preview.mp4',
      playFileUrl: 'https://cdn.example.com/full.mp4',
    });

    renderWithProviders(
      <MemeModal meme={meme} isOpen onClose={onClose} onUpdate={onUpdate} isOwner={false} mode="viewer" />,
      { preloadedState: { auth: { user: null, loading: false, error: null } } },
    );

    const preview = document.querySelector('[data-testid="meme-modal-preview"]');
    const full = document.querySelector('[data-testid="meme-modal-full"]');

    expect(preview).not.toBeNull();
    expect(full).not.toBeNull();
    expect(preview?.getAttribute('src')).toBe('https://cdn.example.com/preview.mp4');
    expect(full?.getAttribute('src')).toBe('https://cdn.example.com/full.mp4');
    expect(full?.getAttribute('preload')).toBe('metadata');
  });
});
