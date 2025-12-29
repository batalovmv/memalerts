import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { server } from '@/test/msw/server';
import {
  mockModerationMemeAssets,
  mockModerationHideOk,
  mockModerationQuarantineOk,
} from '@/test/msw/handlers';
import { makeModerationAsset } from '@/test/fixtures/moderation';
import { makeGlobalModeratorUser } from '@/test/fixtures/user';
import { renderWithProviders } from '@/test/test-utils';

import ModerationPage from './ModerationPage';

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/components/Header', () => ({
  default: function HeaderMock() {
    return <div data-testid="header" />;
  },
}));

describe('ModerationPage (integration)', () => {
  it('loads and renders moderation assets list', async () => {
    const asset = makeModerationAsset({ id: 'asset_1234567890abcdef', fileUrl: null, poolVisibility: 'hidden' });
    server.use(mockModerationMemeAssets({ items: [asset], total: 1, limit: 30, offset: 0 }));

    renderWithProviders(<ModerationPage />, {
      route: '/moderation',
      preloadedState: {
        auth: { user: makeGlobalModeratorUser(), loading: false, error: null },
      } as any,
    });

    expect(await screen.findByText(/pool moderation/i)).toBeInTheDocument();
    // Title is derived from id (first 8 chars).
    expect(await screen.findByText('Asset asset_12')).toBeInTheDocument();
    // "Hidden" exists both as a filter button and as a badge on the card; ensure the badge is present.
    const hiddenEls = screen.getAllByText(/^Hidden$/i);
    expect(hiddenEls.some((el) => el.tagName === 'SPAN')).toBe(true);
  });

  it('shows toast error when moderation list request fails', async () => {
    server.use(
      http.get('*/moderation/meme-assets*', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    );

    renderWithProviders(<ModerationPage />, {
      route: '/moderation',
      preloadedState: {
        auth: { user: makeGlobalModeratorUser(), loading: false, error: null },
      } as any,
    });

    await screen.findByText(/pool moderation/i);
    const toast = (await import('react-hot-toast')).default as unknown as { error: ReturnType<typeof vi.fn> };
    await waitFor(() => expect(toast.error).toHaveBeenCalled(), { timeout: 3000 });
  });

  it('requires reason >= 3 for quarantine and calls API with reason when valid', async () => {
    const user = userEvent.setup();
    const asset = makeModerationAsset({ id: 'asset_1234567890abcdef', fileUrl: null, poolVisibility: 'visible' });

    const quarantineAssert = vi.fn();

    // Initial load + refresh after action use the same list for this test.
    server.use(
      mockModerationMemeAssets({ items: [asset], total: 1, limit: 30, offset: 0 }),
      mockModerationQuarantineOk(({ id, reason }) => quarantineAssert({ id, reason })),
    );

    renderWithProviders(<ModerationPage />, {
      route: '/moderation',
      preloadedState: {
        auth: { user: makeGlobalModeratorUser(), loading: false, error: null },
      } as any,
    });

    expect(await screen.findByText('Asset asset_12')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /delete \(quarantine\)/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    // Try to confirm with empty reason.
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    const toast = (await import('react-hot-toast')).default as unknown as { error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn> };
    expect(toast.error).toHaveBeenCalled();
    expect(quarantineAssert).not.toHaveBeenCalled();

    // Open again and provide valid reason.
    await user.click(screen.getByRole('button', { name: /delete \(quarantine\)/i }));
    const textarea = await screen.findByPlaceholderText(/describe why this should be deleted/i);
    await user.type(textarea, 'dmca');
    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    // API call should happen with encoded :id and provided reason.
    await waitFor(
      () => expect(quarantineAssert).toHaveBeenCalledWith({ id: encodeURIComponent(asset.id), reason: 'dmca' }),
      { timeout: 3000 },
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it('status filter: clicking "All" requests status=all and renders returned assets', async () => {
    const userEv = userEvent.setup();
    const calls: string[] = [];

    server.use(
      http.get('*/moderation/meme-assets*', ({ request }) => {
        const url = new URL(request.url);
        calls.push(url.searchParams.get('status') || '');

        const status = (url.searchParams.get('status') || 'hidden').toLowerCase();
        const asset =
          status === 'all'
            ? makeModerationAsset({ id: 'asset_all_12345678', poolVisibility: 'visible', fileUrl: null })
            : makeModerationAsset({ id: 'asset_hidden_12345678', poolVisibility: 'hidden', fileUrl: null });

        return HttpResponse.json([asset], {
          headers: { 'x-total': '1', 'x-limit': '30', 'x-offset': url.searchParams.get('offset') || '0' },
        });
      }),
    );

    renderWithProviders(<ModerationPage />, {
      route: '/moderation',
      preloadedState: {
        auth: { user: makeGlobalModeratorUser(), loading: false, error: null },
      } as any,
    });

    expect(await screen.findByText('Asset asset_hi')).toBeInTheDocument();

    await userEv.click(screen.getByRole('button', { name: /^all$/i }));
    expect(await screen.findByText('Asset asset_al')).toBeInTheDocument();

    expect(calls).toContain('hidden');
    expect(calls).toContain('all');
  });

  it('search: debounces q and sends it to /moderation/meme-assets', async () => {
    const userEv = userEvent.setup();

    const qs: string[] = [];
    server.use(
      http.get('*/moderation/meme-assets*', ({ request }) => {
        const url = new URL(request.url);
        qs.push(url.searchParams.get('q') || '');
        return HttpResponse.json([], { headers: { 'x-total': '0', 'x-limit': '30', 'x-offset': url.searchParams.get('offset') || '0' } });
      }),
    );

    renderWithProviders(<ModerationPage />, {
      route: '/moderation',
      preloadedState: {
        auth: { user: makeGlobalModeratorUser(), loading: false, error: null },
      } as any,
    });

    const input = await screen.findByPlaceholderText(/search by id\/hash/i);
    await userEv.type(input, 'hash_abc');

    // Debounce is 250ms; use waitFor with a bit of slack (real timers).
    await waitFor(() => expect(qs).toContain('hash_abc'), { timeout: 3000 });
    expect(await screen.findByText(/no items found/i)).toBeInTheDocument();
  });

  it('pagination: "Load more" requests next page with offset=30 and appends', async () => {
    const userEv = userEvent.setup();

    const offsets: number[] = [];
    server.use(
      http.get('*/moderation/meme-assets*', ({ request }) => {
        const url = new URL(request.url);
        const offset = Number(url.searchParams.get('offset') || 0);
        offsets.push(offset);

        if (offset === 0) {
          return HttpResponse.json(
            Array.from({ length: 30 }).map((_, i) => makeModerationAsset({ id: `asset_${String(i).padStart(2, '0')}_abcdef`, fileUrl: null })),
            { headers: { 'x-total': '31', 'x-limit': '30', 'x-offset': '0' } },
          );
        }

        if (offset === 30) {
          return HttpResponse.json([makeModerationAsset({ id: 'asset_30_abcdef', fileUrl: null })], {
            headers: { 'x-total': '31', 'x-limit': '30', 'x-offset': '30' },
          });
        }

        return HttpResponse.json([], { headers: { 'x-total': '31', 'x-limit': '30', 'x-offset': String(offset) } });
      }),
    );

    renderWithProviders(<ModerationPage />, {
      route: '/moderation',
      preloadedState: {
        auth: { user: makeGlobalModeratorUser(), loading: false, error: null },
      } as any,
    });

    expect(await screen.findByText('Asset asset_00')).toBeInTheDocument();
    expect(offsets).toContain(0);

    await userEv.click(screen.getByRole('button', { name: /load more/i }));
    expect(await screen.findByText('Asset asset_30')).toBeInTheDocument();
    expect(offsets).toContain(30);
  });

  it('fast confirm: double-clicking confirm triggers the action only once', async () => {
    const userEv = userEvent.setup();
    const asset = makeModerationAsset({ id: 'asset_fast_1234567890abcdef', fileUrl: null, poolVisibility: 'visible' });

    const hideCalls = vi.fn();
    server.use(
      mockModerationMemeAssets({ items: [asset], total: 1, limit: 30, offset: 0 }),
      mockModerationHideOk(() => hideCalls()),
    );

    renderWithProviders(<ModerationPage />, {
      route: '/moderation',
      preloadedState: {
        auth: { user: makeGlobalModeratorUser(), loading: false, error: null },
      } as any,
    });

    expect(await screen.findByText('Asset asset_fa')).toBeInTheDocument();

    await userEv.click(screen.getByRole('button', { name: /^hide$/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();

    // Confirm button text defaults to "Confirm" in ConfirmDialog.
    const confirmBtn = screen.getByRole('button', { name: /^confirm$/i });
    await userEv.dblClick(confirmBtn);

    await waitFor(() => expect(hideCalls).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });
});


