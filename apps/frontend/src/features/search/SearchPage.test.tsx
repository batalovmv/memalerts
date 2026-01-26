import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, screen, waitFor } from '@testing-library/react';

import SearchPage from './SearchPage';
import { renderWithProviders } from '@/test/test-utils';
import { server } from '@/test/msw/server';
import { mockChannelMemesSearch } from '@/test/msw/handlers';
import { makeMeme, makeTag } from '@/test/fixtures/memes';

vi.mock('@/components/Header', () => ({
  default: function HeaderMock() {
    return <div data-testid="header" />;
  },
}));

describe('SearchPage (integration)', () => {
  it('debounces query typing (500ms) and performs a single request after delay', async () => {
    const user = userEvent.setup();

    const urls: URL[] = [];
    server.use(
      mockChannelMemesSearch([], (url) => urls.push(url)),
    );

    renderWithProviders(<SearchPage />, { route: '/search' });

    await waitFor(() => expect(urls.length).toBe(1));

    const searchInput = screen.getByPlaceholderText(/search memes by title/i);
    await user.type(searchInput, 'abc');

    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    // Before debounce fires, there must be no request with q=abc.
    expect(urls.some((u) => u.searchParams.get('q') === 'abc')).toBe(false);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    await waitFor(() => expect(urls.some((u) => u.searchParams.get('q') === 'abc')).toBe(true));

    const withQ = urls.find((u) => u.searchParams.get('q') === 'abc')!;
    expect(withQ.searchParams.get('limit')).toBe('50');
  });

  it('updates request query when numeric filters change (minPrice)', async () => {
    const user = userEvent.setup();

    const urls: URL[] = [];
    server.use(
      mockChannelMemesSearch([], (url) => urls.push(url)),
    );

    renderWithProviders(<SearchPage />, { route: '/search' });
    await waitFor(() => expect(urls.length).toBe(1));

    const [minPriceInput] = screen.getAllByRole('spinbutton');
    await user.clear(minPriceInput);
    await user.type(minPriceInput, '10');

    // Filter changes are not debounced; they should trigger immediately.
    await waitFor(() => {
      expect(urls.length).toBeGreaterThanOrEqual(2);
      expect(urls.at(-1)!.searchParams.get('minPrice')).toBe('10');
    });
    expect(urls.at(-1)!.searchParams.get('sortBy')).toBe('createdAt');
    expect(urls.at(-1)!.searchParams.get('sortOrder')).toBe('desc');
  });

  it('extracts tags from results and toggling a tag triggers a new request with tags=', async () => {
    const user = userEvent.setup();

    const tagFun = makeTag({ id: 't1', name: 'fun' });
    const tagLol = makeTag({ id: 't2', name: 'lol' });
    const memes = [
      makeMeme({
        id: 'm1',
        title: 'A',
        tags: [tagFun, tagLol],
      }),
    ];

    const urls: URL[] = [];
    server.use(
      mockChannelMemesSearch(memes, (url) => urls.push(url)),
    );

    renderWithProviders(<SearchPage />, { route: '/search' });
    await waitFor(() => expect(urls.length).toBe(1));

    // Tags appear based on results
    const funBtn = await screen.findByRole('button', { name: /^fun$/i });
    expect(funBtn).toHaveAttribute('aria-pressed', 'false');

    await user.click(funBtn);
    await waitFor(() => expect(urls.length).toBe(2));
    expect(urls[1]!.searchParams.get('tags')).toBe('fun');
    expect(funBtn).toHaveAttribute('aria-pressed', 'true');
  });
});


