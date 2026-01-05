import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { Meme } from '@/types';

import { AiRegenerateButton } from './AiRegenerateButton';

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/shared/api/streamerMemes', async (orig) => {
  const mod = (await orig()) as object;
  return {
    ...(mod as any),
    regenerateMemeAi: vi.fn().mockResolvedValue({ data: {}, meta: { status: 202, headers: {} } }),
  };
});

function makeMeme(partial: Partial<Meme>): Meme {
  return {
    id: partial.id || 'm1',
    title: partial.title || 'Meme',
    type: partial.type || 'video',
    fileUrl: partial.fileUrl || '/x.mp4',
    priceCoins: partial.priceCoins ?? 1,
    durationMs: partial.durationMs ?? 0,
    ...partial,
  };
}

describe('AiRegenerateButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is disabled before 5 minutes since createdAt when aiAutoDescription is missing', () => {
    const createdAt = new Date(Date.now() - 4 * 60_000).toISOString();
    render(<AiRegenerateButton meme={makeMeme({ createdAt, channelId: 'c1', aiAutoDescription: null })} show />);
    const btn = screen.getByRole('button', { name: /ai regenerate/i });
    expect(btn).toBeDisabled();
  });

  it('is enabled after 5 minutes since createdAt when aiAutoDescription is missing', () => {
    const createdAt = new Date(Date.now() - 6 * 60_000).toISOString();
    render(<AiRegenerateButton meme={makeMeme({ createdAt, channelId: 'c1', aiAutoDescription: null })} show />);
    const btn = screen.getByRole('button', { name: /^ai regenerate$/i });
    expect(btn).toBeEnabled();
  });

  it('does not render when aiAutoDescription is present', () => {
    render(<AiRegenerateButton meme={makeMeme({ channelId: 'c1', aiAutoDescription: 'ok' })} show />);
    expect(screen.queryByRole('button', { name: /ai regenerate/i })).toBeNull();
  });
});


