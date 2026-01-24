import React from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { http, HttpResponse } from 'msw';

import StreamerProfilePage from './StreamerProfilePage';
import { renderWithProviders } from '@/test/test-utils';
import { server } from '@/test/msw/server';
import { mockChannel, mockChannelMemesSearch, mockChannelWallet, mockMemesPool, mockPublicChannel } from '@/test/msw/handlers';
import { makeMeme } from '@/test/fixtures/memes';
import { makeViewerUser } from '@/test/fixtures/user';

vi.mock('@/shared/lib/ChannelThemeProvider', () => ({
  default: function ChannelThemeProviderMock(props: { children: React.ReactNode }) {
    return <>{props.children}</>;
  },
}));

vi.mock('@/components/Header', () => ({
  default: function HeaderMock() {
    return <div data-testid="header" />;
  },
}));

vi.mock('@/widgets/meme-card/MemeCard', () => ({
  default: function MemeCardMock(props: { meme: { title: string }; onClick?: () => void }) {
    return (
      <button type="button" onClick={props.onClick} aria-label={`meme:${props.meme.title}`}>
        {props.meme.title}
      </button>
    );
  },
}));

vi.mock('@/components/MemeModal', () => ({
  default: function MemeModalMock() {
    return <div data-testid="meme-modal" />;
  },
}));

vi.mock('@/components/SubmitModal', () => ({
  default: function SubmitModalMock(props: { isOpen: boolean }) {
    return props.isOpen ? <div data-testid="submit-modal-open" /> : null;
  },
}));

vi.mock('@/components/AuthRequiredModal', () => ({
  default: function AuthRequiredModalMock(props: { isOpen: boolean }) {
    return props.isOpen ? <div data-testid="auth-required-modal-open" /> : null;
  },
}));

vi.mock('@/components/CoinsInfoModal', () => ({
  default: function CoinsInfoModalMock() {
    return <div data-testid="coins-info-modal" />;
  },
}));

vi.mock('@/shared/lib/hooks', () => ({
  useAutoplayMemes: () => ({ autoplayMemesEnabled: false }),
  useDebounce: <T,>(value: T) => value,
  useHotkeys: () => {},
}));

function TestRoutes() {
  return (
    <Routes>
      <Route path="/channel/:slug" element={<StreamerProfilePage />} />
    </Routes>
  );
}

describe('StreamerProfilePage (integration)', () => {
  const originalIntersectionObserver = globalThis.IntersectionObserver;

  beforeAll(() => {
    // Minimal IntersectionObserver stub (used for infinite scroll).
    // It should not throw, and we don't need it to actually trigger loadMore in these tests.
    // @ts-expect-error test env polyfill
    globalThis.IntersectionObserver = class IO {
      observe() {}
      unobserve() {}
      disconnect() {}
      constructor(_cb: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {}
    };
  });

  afterAll(() => {
    globalThis.IntersectionObserver = originalIntersectionObserver;
  });

  it('guest: loads public channel + memes list and shows login CTA + favorites opens auth modal', async () => {
    const user = userEvent.setup();
    const slug = 'testchannel';

    const memesCalls: URL[] = [];

    server.use(
      // The page prefers /channels/:slug for initial load; also allow /public/* as fallback.
      mockChannel(slug, {
        id: 'c1',
        slug,
        name: 'Test Channel',
        coinPerPointRatio: 1,
        stats: { memesCount: 1, usersCount: 2 },
      }),
      mockPublicChannel(slug, {
        id: 'c1',
        slug,
        name: 'Test Channel',
        coinPerPointRatio: 1,
        stats: { memesCount: 1, usersCount: 2 },
      }),
      mockChannelMemesSearch([makeMeme({ id: 'm1', title: 'First meme', channelId: 'c1' })], (u) => memesCalls.push(u)),
    );

    renderWithProviders(<TestRoutes />, { route: `/channel/${slug}` });

    expect(await screen.findByRole('heading', { name: /test channel/i })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /log in with twitch/i })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /available memes/i })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /meme:first meme/i })).toBeInTheDocument();

    // The page should load memes with default params (limit=40 offset=0).
    await waitFor(() => expect(memesCalls.length).toBeGreaterThanOrEqual(1));
    expect(memesCalls[0]!.searchParams.get('limit')).toBe('40');
    expect(memesCalls[0]!.searchParams.get('offset')).toBe('0');
    expect(memesCalls[0]!.searchParams.get('channelSlug')).toBe(slug);

    // Clicking favorites while logged out should open auth required modal
    await user.click(screen.getByRole('button', { name: /my favorites/i }));
    expect(await screen.findByTestId('auth-required-modal-open')).toBeInTheDocument();
  });

  it('guest: falls back to /public/* when /channels/* fails (back-compat)', async () => {
    const slug = 'testchannel';

    server.use(
      // Simulate /channels/* not available for guests in some deployments.
      // Match only same-origin `/channels/:slug` (not `/public/channels/:slug`).
      http.get(/.*\/\/[^/]+\/channels\/[^/?]+(\?.*)?$/, ({ request }) => {
        const url = new URL(request.url);
        const actual = String(url.pathname.split('/').pop() ?? '');
        if (actual !== slug) return new HttpResponse(null, { status: 404 });
        return HttpResponse.json({ error: 'forbidden' }, { status: 403 });
      }),
      // /public/* still works.
      mockPublicChannel(slug, {
        id: 'c1',
        slug,
        name: 'Test Channel',
        coinPerPointRatio: 1,
        stats: { memesCount: 1, usersCount: 2 },
      }),
      mockChannelMemesSearch([makeMeme({ id: 'm1', title: 'First meme', channelId: 'c1' })]),
    );

    renderWithProviders(<TestRoutes />, { route: `/channel/${slug}` });

    expect(await screen.findByRole('heading', { name: /test channel/i })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /available memes/i })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /meme:first meme/i })).toBeInTheDocument();
  });

  it('authed viewer (not owner): shows "Submit meme" button and opens SubmitModal on click; wallet is requested if missing', async () => {
    const user = userEvent.setup();
    const slug = 'testchannel';
    const me = makeViewerUser({ id: 'u1', channelId: null, wallets: [] });

    const walletCalls: URL[] = [];

    server.use(
      mockChannel(slug, {
        id: 'c1',
        slug,
        name: 'Test Channel',
        coinPerPointRatio: 1,
        stats: { memesCount: 0, usersCount: 0 },
      }),
      mockPublicChannel(slug, {
        id: 'c1',
        slug,
        name: 'Test Channel',
        coinPerPointRatio: 1,
        stats: { memesCount: 0, usersCount: 0 },
      }),
      mockChannelMemesSearch([], () => {}),
      mockChannelWallet({ id: 'w1', userId: 'u1', channelId: 'c1', balance: 123 }, (u) => walletCalls.push(u)),
    );

    renderWithProviders(<TestRoutes />, {
      route: `/channel/${slug}`,
      preloadedState: { auth: { user: me, loading: false, error: null } },
    });

    const submitBtn = await screen.findByRole('button', { name: /submit.*meme/i });
    await user.click(submitBtn);
    expect(await screen.findByTestId('submit-modal-open')).toBeInTheDocument();

    await waitFor(() => expect(walletCalls.length).toBe(1));
  });

  it('search inside channel page: typing triggers debounced search request', async () => {
    const user = userEvent.setup();
    const slug = 'testchannel';

    const searchCalls: URL[] = [];

    server.use(
      mockChannel(slug, {
        id: 'c1',
        slug,
        name: 'Test Channel',
        coinPerPointRatio: 1,
        stats: { memesCount: 0, usersCount: 0 },
      }),
      mockPublicChannel(slug, {
        id: 'c1',
        slug,
        name: 'Test Channel',
        coinPerPointRatio: 1,
        stats: { memesCount: 0, usersCount: 0 },
      }),
      mockChannelMemesSearch([makeMeme({ id: 'm1', title: 'Searched meme', channelId: 'c1' })], (u) => searchCalls.push(u)),
    );

    renderWithProviders(<TestRoutes />, { route: `/channel/${slug}` });
    await screen.findByRole('heading', { name: /test channel/i });

    const searchInput = screen.getByPlaceholderText(/search memes by title/i);
    await user.type(searchInput, 'abc');

    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });

    // Note: the page also loads the initial memes list via the same endpoint.
    // Assert specifically on the debounced search request (q=abc).
    await waitFor(() => expect(searchCalls.some((u) => u.searchParams.get('q') === 'abc')).toBe(true));
    const qCall = searchCalls.find((u) => u.searchParams.get('q') === 'abc')!;
    expect(qCall.searchParams.get('q')).toBe('abc');
    expect(qCall.searchParams.get('channelSlug')).toBe(slug);
    expect(await screen.findByRole('button', { name: /meme:searched meme/i })).toBeInTheDocument();
  });

  it('pool_all mode: loads list from /memes/pool (global pool) instead of channel-only listing', async () => {
    const slug = 'testchannel';
    const poolCalls: URL[] = [];

    server.use(
      mockChannel(slug, {
        id: 'c1',
        slug,
        name: 'Test Channel',
        memeCatalogMode: 'pool_all',
        coinPerPointRatio: 1,
        stats: { memesCount: 1, usersCount: 2 },
      }),
      mockPublicChannel(slug, {
        id: 'c1',
        slug,
        name: 'Test Channel',
        memeCatalogMode: 'pool_all',
        coinPerPointRatio: 1,
        stats: { memesCount: 1, usersCount: 2 },
      }),
      mockMemesPool([{ id: 'asset_1', memeAssetId: 'asset_1', type: 'video', fileUrl: 'https://example.com/a.webm', sampleTitle: 'Pool meme' }], (u) =>
        poolCalls.push(u),
      ),
      // Keep channel endpoint available as fallback; test asserts we used pool endpoint.
      mockChannelMemesSearch([makeMeme({ id: 'm1', title: 'Channel meme', channelId: 'c1' })]),
    );

    renderWithProviders(<TestRoutes />, { route: `/channel/${slug}` });

    expect(await screen.findByRole('heading', { name: /test channel/i })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /available memes/i })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /meme:pool meme/i })).toBeInTheDocument();

    await waitFor(() => expect(poolCalls.length).toBe(1));
    expect(poolCalls[0]!.pathname.endsWith('/memes/pool')).toBe(true);
    expect(poolCalls[0]!.searchParams.get('limit')).toBe('40');
    expect(poolCalls[0]!.searchParams.get('offset')).toBe('0');
  });
});


