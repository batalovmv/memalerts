import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { OwnerMemeAssetsModeration } from './OwnerMemeAssetsModeration';
import { renderWithProviders } from '@/test/test-utils';
import { server } from '@/test/msw/server';
import { mockOwnerMemeAssetRestoreOk } from '@/test/msw/handlers';

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('OwnerMemeAssetsModeration (integration)', () => {
  it('loads owner meme assets list and restores an asset (POST /restore + refresh)', async () => {
    const user = userEvent.setup();

    let items: any[] = [
      {
        id: 'asset_1234567890abcdef',
        type: 'image',
        fileUrl: null,
        fileHash: 'hash_abcdef012345',
        poolVisibility: 'visible',
        purgeRequestedAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
        purgedAt: null,
      },
    ];

    const restoreAssert = vi.fn();
    const listCalls: URL[] = [];

    server.use(
      http.get('*/owner/meme-assets*', ({ request }) => {
        listCalls.push(new URL(request.url));
        return HttpResponse.json(items);
      }),
      mockOwnerMemeAssetRestoreOk(({ id }) => {
        restoreAssert({ id });
        items = [];
      }),
    );

    renderWithProviders(<OwnerMemeAssetsModeration />, { route: '/settings?tab=ownerMemeAssets' });

    // Initial list load uses default filter status=quarantine and limit=30.
    await waitFor(() => expect(listCalls.length).toBe(1));
    expect(listCalls[0]!.searchParams.get('status')).toBe('quarantine');
    expect(listCalls[0]!.searchParams.get('limit')).toBe('30');
    expect(listCalls[0]!.searchParams.get('offset')).toBe('0');

    // Asset card appears (title uses first 8 chars).
    expect(await screen.findByText('asset_12')).toBeInTheDocument();

    // Restore flow.
    await user.click(screen.getByRole('button', { name: /restore/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^restore$/i }));

    await waitFor(() => expect(restoreAssert).toHaveBeenCalledWith({ id: encodeURIComponent('asset_1234567890abcdef') }));
    await waitFor(() => expect(listCalls.length).toBeGreaterThanOrEqual(2));
    expect(await screen.findByText(/no items found/i)).toBeInTheDocument();
  });
});









