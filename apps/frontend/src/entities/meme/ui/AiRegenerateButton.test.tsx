import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { Meme } from '@/types';

import { regenerateMemeAi } from '@/shared/api/streamerMemes';
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
    vi.clearAllMocks();
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

  it('renders when aiAutoDescription duplicates title (after normalization)', () => {
    const createdAt = new Date(Date.now() - 6 * 60_000).toISOString();
    render(
      <AiRegenerateButton
        meme={makeMeme({ createdAt, channelId: 'c1', title: 'Test!', aiAutoDescription: '   test  ' })}
        show
      />,
    );
    expect(screen.getByRole('button', { name: /ai regenerate/i })).toBeInTheDocument();
  });

  it('renders when aiAutoDescription is a known placeholder', () => {
    const createdAt = new Date(Date.now() - 6 * 60_000).toISOString();
    render(<AiRegenerateButton meme={makeMeme({ createdAt, channelId: 'c1', aiAutoDescription: 'meme' })} show />);
    expect(screen.getByRole('button', { name: /ai regenerate/i })).toBeInTheDocument();
  });

  it('calls regenerate endpoint with channelMemeId (not legacy id) when available', async () => {
    const createdAt = new Date(Date.now() - 6 * 60_000).toISOString();
    render(
      <AiRegenerateButton
        meme={makeMeme({
          createdAt,
          channelId: 'c1',
          id: 'legacy-meme-id',
          channelMemeId: 'channel-meme-id',
          aiAutoDescription: null,
        })}
        show
      />,
    );

    const btn = screen.getByRole('button', { name: /^ai regenerate$/i });
    fireEvent.click(btn);

    // With fake timers enabled in this suite, RTL's waitFor() polling won't advance unless we manually tick timers.
    // The click handler calls regenerateMemeAi(primaryId) synchronously before its first await, so we can assert directly.
    expect(regenerateMemeAi).toHaveBeenCalledWith('channel-meme-id');
  });
});


