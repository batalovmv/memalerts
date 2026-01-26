import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import type { MemeDetail } from '@memalerts/api-contracts';

import { regenerateMemeAi } from '@/shared/api/channel';
import { AiRegenerateButton } from './AiRegenerateButton';

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/shared/api/channel', async (orig) => {
  const mod = (await orig()) as typeof import('@/shared/api/channel');
  return {
    ...mod,
    regenerateMemeAi: vi.fn().mockResolvedValue({ data: {}, meta: { status: 202, headers: {} } }),
  };
});

vi.mock('@/shared/lib/hooks', async (orig) => {
  const mod = (await orig()) as typeof import('@/shared/lib/hooks');
  return {
    ...mod,
    // Avoid interval-driven state updates in tests (prevents act() warnings).
    useSharedNow: () => Date.now(),
  };
});

function makeMeme(partial: Partial<MemeDetail>): MemeDetail {
  return {
    id: partial.id || 'm1',
    title: partial.title || 'Meme',
    type: partial.type || 'video',
    fileUrl: partial.fileUrl || '/x.mp4',
    previewUrl: partial.previewUrl ?? null,
    variants: partial.variants ?? [],
    priceCoins: partial.priceCoins ?? 1,
    durationMs: partial.durationMs ?? 0,
    activationsCount: partial.activationsCount ?? 0,
    createdAt: partial.createdAt ?? '2024-01-01T00:00:00.000Z',
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
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });

    // With fake timers enabled in this suite, RTL's waitFor() polling won't advance unless we manually tick timers.
    // The click handler calls regenerateMemeAi(primaryId) synchronously before its first await, so we can assert directly.
    expect(regenerateMemeAi).toHaveBeenCalledWith('channel-meme-id');
  });
});




