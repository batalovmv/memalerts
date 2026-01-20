import React from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import DashboardPage from './DashboardPage';
import { renderWithProviders } from '@/test/test-utils';
import { server } from '@/test/msw/server';
import { mockChannel, mockMySubmissions, mockStreamerBots, mockStreamerMemes, mockStreamerSubmissions } from '@/test/msw/handlers';
import { makeStreamerUser } from '@/test/fixtures/user';
import { makeMeme } from '@/test/fixtures/memes';

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

vi.mock('@/contexts/HelpModeContext', () => ({
  useHelpMode: () => ({ enabled: false, setEnabled: vi.fn() }),
}));

vi.mock('@/hooks/useAutoplayMemes', () => ({
  useAutoplayMemes: () => ({ autoplayMemesEnabled: false }),
}));

vi.mock('@/components/SubmitModal', () => ({
  default: function SubmitModalMock() {
    return null;
  },
}));

vi.mock('@/components/MemeModal', () => ({
  default: function MemeModalMock() {
    return null;
  },
}));

vi.mock('@/components/SecretCopyField', () => ({
  default: function SecretCopyFieldMock(props: { label: string; value: string }) {
    return (
      <div data-testid="secret-copy-field">
        <div>{props.label}</div>
        <div data-testid={`secret:${props.label}`}>{props.value}</div>
      </div>
    );
  },
}));

// Keep dashboard tests lightweight: verify that actions open the correct modal,
// but don't mount the full modal UI (focus traps/portals/etc).
vi.mock('@/features/dashboard/ui/modals/ApproveSubmissionModal', () => ({
  ApproveSubmissionModal: (props: { isOpen: boolean }) => (props.isOpen ? <div data-testid="approve-modal-open" /> : null),
}));
vi.mock('@/features/dashboard/ui/modals/NeedsChangesModal', () => ({
  NeedsChangesModal: (props: { isOpen: boolean }) => (props.isOpen ? <div data-testid="needs-changes-modal-open" /> : null),
}));
vi.mock('@/features/dashboard/ui/modals/RejectSubmissionModal', () => ({
  RejectSubmissionModal: (props: { isOpen: boolean }) => (props.isOpen ? <div data-testid="reject-modal-open" /> : null),
}));

describe('DashboardPage (integration)', () => {
  const originalIntersectionObserver = globalThis.IntersectionObserver;

  beforeAll(() => {
    // Minimal IntersectionObserver stub (used for infinite scroll).
    // It should not throw, and we don't need it to actually trigger loadMore in most tests.
    // @ts-expect-error test env polyfill
    globalThis.IntersectionObserver = class IO {
      observe() {}
      unobserve() {}
      disconnect() {}
      constructor(_cb: any, _opts?: any) {}
    };
  });

  afterAll(() => {
    globalThis.IntersectionObserver = originalIntersectionObserver;
  });

  it('back-compat: /dashboard?tab=submissions auto-opens submissions panel', async () => {
    const user = makeStreamerUser();
    server.use(
      mockChannel(user.channel!.slug, { stats: { memesCount: 0 }, submissionsEnabled: true, submissionsOnlyWhenLive: false, dashboardCardOrder: null }),
      mockStreamerBots([]),
      mockStreamerSubmissions({ items: [], total: 0 }),
      mockMySubmissions([]),
    );

    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false } as any));

    renderWithProviders(<DashboardPage />, {
      route: '/dashboard?tab=submissions',
      preloadedState: { auth: { user, loading: false, error: null } } as any,
    });

    // Panels are always mounted; open/close is controlled via Tailwind `hidden`/`block` classes.
    const panel = await screen.findByLabelText(/^submissions$/i, { selector: 'section' });
    expect(panel).toHaveClass('block');
  });

  it('clicking "All memes" card toggles memes panel open/closed', async () => {
    const userEv = userEvent.setup();
    const user = makeStreamerUser();
    server.use(
      mockChannel(user.channel!.slug, { stats: { memesCount: 3 }, submissionsEnabled: true, submissionsOnlyWhenLive: false, dashboardCardOrder: null }),
      mockStreamerBots([]),
      mockStreamerSubmissions({ items: [], total: 0 }),
      mockMySubmissions([]),
      mockStreamerMemes({ items: [], hasMore: false, totalCount: 0 }),
    );

    // Avoid mobile scroll side effects.
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false } as any));

    renderWithProviders(<DashboardPage />, {
      route: '/dashboard',
      preloadedState: { auth: { user, loading: false, error: null } } as any,
    });

    const panel = screen.getByLabelText(/all memes/i, { selector: 'section' });
    expect(panel).toHaveClass('hidden');

    await userEv.click(screen.getByRole('button', { name: /all memes/i }));
    expect(panel).toHaveClass('block');

    await userEv.click(screen.getByRole('button', { name: /all memes/i }));
    expect(panel).toHaveClass('hidden');
  });

  it('all memes: renders real MemeCard items from /streamer/memes', async () => {
    const userEv = userEvent.setup();
    const user = makeStreamerUser();

    server.use(
      mockChannel(user.channel!.slug, { stats: { memesCount: 1 }, submissionsEnabled: true, submissionsOnlyWhenLive: false, dashboardCardOrder: null }),
      mockStreamerBots([]),
      mockStreamerSubmissions({ items: [], total: 0 }),
      mockMySubmissions([]),
      mockStreamerMemes({
        items: [makeMeme({ id: 'm1', title: 'First meme', channelId: user.channel!.id })],
        hasMore: false,
        totalCount: 1,
      }),
    );

    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false } as any));

    renderWithProviders(<DashboardPage />, {
      route: '/dashboard',
      preloadedState: { auth: { user, loading: false, error: null } } as any,
    });

    await userEv.click(screen.getByRole('button', { name: /all memes/i }));

    const panel = await screen.findByLabelText(/all memes/i, { selector: 'section' });
    expect(panel).toHaveClass('block');
    expect(await screen.findByRole('button', { name: /meme:\s*first meme/i }, { timeout: 3000 })).toBeInTheDocument();
  });

  it('all memes: renders empty state when /streamer/memes returns []', async () => {
    const userEv = userEvent.setup();
    const user = makeStreamerUser();
    server.use(
      mockChannel(user.channel!.slug, { stats: { memesCount: 0 }, submissionsEnabled: true, submissionsOnlyWhenLive: false, dashboardCardOrder: null }),
      mockStreamerBots([]),
      mockStreamerSubmissions({ items: [], total: 0 }),
      mockMySubmissions([]),
      mockStreamerMemes({ items: [], hasMore: false, totalCount: 0 }),
    );

    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false } as any));

    renderWithProviders(<DashboardPage />, {
      route: '/dashboard',
      preloadedState: { auth: { user, loading: false, error: null } } as any,
    });

    await userEv.click(screen.getByRole('button', { name: /all memes/i }));

    expect(await screen.findByText(/no memes/i)).toBeInTheDocument();
  });

  it('all memes: shows error + retry when /streamer/memes fails, then succeeds after retry', async () => {
    const userEv = userEvent.setup();
    const user = makeStreamerUser();

    let calls = 0;
    server.use(
      mockChannel(user.channel!.slug, { stats: { memesCount: 1 }, submissionsEnabled: true, submissionsOnlyWhenLive: false, dashboardCardOrder: null }),
      mockStreamerBots([]),
      mockStreamerSubmissions({ items: [], total: 0 }),
      mockMySubmissions([]),
      http.get('*/streamer/memes*', () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({ error: 'nope' }, { status: 500 });
        return HttpResponse.json([makeMeme({ id: 'm1', title: 'Recovered meme', channelId: user.channel!.id })]);
      }),
    );

    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false } as any));

    renderWithProviders(<DashboardPage />, {
      route: '/dashboard',
      preloadedState: { auth: { user, loading: false, error: null } } as any,
    });

    await userEv.click(screen.getByRole('button', { name: /all memes/i }));

    expect(await screen.findByText(/failed to load memes/i)).toBeInTheDocument();
    await userEv.click(screen.getByRole('button', { name: /retry/i }));

    expect(await screen.findByRole('button', { name: /meme:\s*recovered meme/i })).toBeInTheDocument();
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('all memes: infinite scroll requests next page with offset=40', async () => {
    const userEv = userEvent.setup();
    const user = makeStreamerUser();

    const offsets: number[] = [];
    server.use(
      mockChannel(user.channel!.slug, { stats: { memesCount: 45 }, submissionsEnabled: true, submissionsOnlyWhenLive: false, dashboardCardOrder: null }),
      mockStreamerBots([]),
      mockStreamerSubmissions({ items: [], total: 0 }),
      mockMySubmissions([]),
      http.get('*/streamer/memes*', ({ request }) => {
        const url = new URL(request.url);
        const offset = Number(url.searchParams.get('offset') || 0);
        offsets.push(offset);

        if (offset === 0) {
          return HttpResponse.json(
            Array.from({ length: 40 }).map((_, i) =>
              makeMeme({ id: `m_${i}`, title: `Meme ${i}`, channelId: user.channel!.id }),
            ),
          );
        }

        if (offset === 40) {
          return HttpResponse.json([makeMeme({ id: 'm_last', title: 'Meme 40', channelId: user.channel!.id })], {
            headers: { 'x-has-more': 'false' },
          });
        }

        return HttpResponse.json([]);
      }),
    );

    // Deterministic IntersectionObserver: triggers "isIntersecting" once per observed element.
    const prevIO = globalThis.IntersectionObserver;
    const seen = new WeakSet<object>();
    // @ts-expect-error test env polyfill
    globalThis.IntersectionObserver = class IO {
      private cb: (entries: Array<{ isIntersecting: boolean; target: Element }>) => void;
      constructor(cb: any) {
        this.cb = cb;
      }
      observe(el: any) {
        if (el && typeof el === 'object') {
          if (seen.has(el)) return;
          seen.add(el);
        }
        this.cb([{ isIntersecting: true, target: el }]);
      }
      unobserve() {}
      disconnect() {}
    };

    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false } as any));

    try {
      renderWithProviders(<DashboardPage />, {
        route: '/dashboard',
        preloadedState: { auth: { user, loading: false, error: null } } as any,
      });

      await userEv.click(screen.getByRole('button', { name: /all memes/i }));

      expect(await screen.findByRole('button', { name: /meme:\s*meme 0/i })).toBeInTheDocument();
      await waitFor(() => expect(offsets).toContain(40), { timeout: 3000 });
      expect(await screen.findByRole('button', { name: /meme:\s*meme 40/i })).toBeInTheDocument();
    } finally {
      globalThis.IntersectionObserver = prevIO;
    }
  });

  it('pending approvals: clicking Approve opens approve modal (smoke)', async () => {
    const userEv = userEvent.setup();
    const user = makeStreamerUser({ id: 'u_streamer' });

    server.use(
      mockChannel(user.channel!.slug, { stats: { memesCount: 0 }, submissionsEnabled: true, submissionsOnlyWhenLive: false, dashboardCardOrder: null }),
      mockStreamerBots([]),
      mockStreamerSubmissions({
        items: [
          {
            id: 'sub_1',
            title: 'Pending submission',
            type: 'video',
            fileUrlTemp: 'https://example.com/pending.webm',
            status: 'pending',
            notes: null,
            createdAt: new Date().toISOString(),
            submitter: { id: 'u_viewer', displayName: 'Viewer' },
            revision: 0,
          },
        ],
        total: 1,
      }),
      mockMySubmissions([]),
    );

    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false } as any));

    renderWithProviders(<DashboardPage />, {
      route: '/dashboard?tab=submissions',
      preloadedState: { auth: { user, loading: false, error: null } } as any,
    });

    const submissionsPanel = await screen.findByLabelText(/^submissions$/i, { selector: 'section' });
    expect(submissionsPanel).toHaveClass('block');

    await userEv.click(await screen.findByRole('button', { name: /^approve$/i }));
    expect(await screen.findByTestId('approve-modal-open')).toBeInTheDocument();
  });

  it('pending approvals: shows error + retry when /streamer/submissions fails, then succeeds', async () => {
    const userEv = userEvent.setup();
    const user = makeStreamerUser({ id: 'u_streamer' });

    let calls = 0;
    server.use(
      mockChannel(user.channel!.slug, { stats: { memesCount: 0 }, submissionsEnabled: true, submissionsOnlyWhenLive: false, dashboardCardOrder: null }),
      mockStreamerBots([]),
      http.get('*/streamer/submissions*', () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({ error: 'nope' }, { status: 500 });
        return HttpResponse.json({
          items: [
            {
              id: 'sub_1',
              title: 'Pending submission',
              type: 'video',
              fileUrlTemp: 'https://example.com/pending.webm',
              status: 'pending',
              notes: null,
              createdAt: new Date().toISOString(),
              submitter: { id: 'u_viewer', displayName: 'Viewer' },
              revision: 0,
            },
          ],
          total: 1,
        });
      }),
    );

    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false } as any));

    renderWithProviders(<DashboardPage />, {
      route: '/dashboard?tab=submissions',
      preloadedState: { auth: { user, loading: false, error: null } } as any,
    });

    expect(await screen.findByText(/failed to load pending submissions/i)).toBeInTheDocument();

    await userEv.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Pending submission')).toBeInTheDocument();
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('pending approvals: infinite scroll requests next page with offset=20', async () => {
    const user = makeStreamerUser({ id: 'u_streamer' });

    const offsets: number[] = [];
    server.use(
      mockChannel(user.channel!.slug, { stats: { memesCount: 0 }, submissionsEnabled: true, submissionsOnlyWhenLive: false, dashboardCardOrder: null }),
      mockStreamerBots([]),
      http.get('*/streamer/submissions*', ({ request }) => {
        const url = new URL(request.url);
        const offset = Number(url.searchParams.get('offset') || 0);
        offsets.push(offset);

        if (offset === 0) {
          return HttpResponse.json({
            items: Array.from({ length: 20 }).map((_, i) => ({
              id: `sub_${i}`,
              title: `Pending ${i}`,
              type: 'video',
              fileUrlTemp: 'https://example.com/pending.webm',
              status: 'pending',
              notes: null,
              createdAt: new Date().toISOString(),
              submitter: { id: 'u_viewer', displayName: 'Viewer' },
              revision: 0,
            })),
            total: 21,
          });
        }

        if (offset === 20) {
          return HttpResponse.json({
            items: [
              {
                id: 'sub_20',
                title: 'Pending 20',
                type: 'video',
                fileUrlTemp: 'https://example.com/pending.webm',
                status: 'pending',
                notes: null,
                createdAt: new Date().toISOString(),
                submitter: { id: 'u_viewer', displayName: 'Viewer' },
                revision: 0,
              },
            ],
            total: 21,
          });
        }

        return HttpResponse.json({ items: [], total: 21 });
      }),
    );

    // Trigger intersect once per observed element (cards + sentinel).
    const prevIO = globalThis.IntersectionObserver;
    const seen = new WeakSet<object>();
    // @ts-expect-error test env polyfill
    globalThis.IntersectionObserver = class IO {
      private cb: (entries: Array<{ isIntersecting: boolean; target: Element }>) => void;
      constructor(cb: any) {
        this.cb = cb;
      }
      observe(el: any) {
        if (el && typeof el === 'object') {
          if (seen.has(el)) return;
          seen.add(el);
        }
        this.cb([{ isIntersecting: true, target: el }]);
      }
      unobserve() {}
      disconnect() {}
    };

    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false } as any));

    try {
      renderWithProviders(<DashboardPage />, {
        route: '/dashboard?tab=submissions',
        preloadedState: { auth: { user, loading: false, error: null } } as any,
      });

      expect(await screen.findByText('Pending 0')).toBeInTheDocument();

      await waitFor(() => expect(offsets).toContain(20), { timeout: 3000 });
      expect(await screen.findByText('Pending 20')).toBeInTheDocument();
    } finally {
      globalThis.IntersectionObserver = prevIO;
    }
  });

  it('clicking "My submissions" opens submissions panel on "mine" tab and loads /submissions', async () => {
    const userEv = userEvent.setup();
    const user = makeStreamerUser({ id: 'u1' });

    const mySubmissionsCalls = vi.fn();
    server.use(
      mockChannel(user.channel!.slug, { stats: { memesCount: 0 }, submissionsEnabled: true, submissionsOnlyWhenLive: false, dashboardCardOrder: null }),
      mockStreamerBots([]),
      mockStreamerSubmissions({ items: [], total: 0 }),
      mockMySubmissions([], mySubmissionsCalls),
    );

    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false } as any));

    renderWithProviders(<DashboardPage />, {
      route: '/dashboard',
      preloadedState: { auth: { user, loading: false, error: null } } as any,
    });

    const mySubmissionsButtons = screen.getAllByRole('button', { name: /my submissions/i });
    const mySubmissionsCard = mySubmissionsButtons.find((el) => !!el.getAttribute('aria-label')) ?? null;
    expect(mySubmissionsCard).toBeTruthy();
    await userEv.click(mySubmissionsCard!);

    // On "mine" tab, the panel shows "No submissions yet." when empty.
    const panel = await screen.findByLabelText(/^submissions$/i, { selector: 'section' });
    expect(panel).toHaveClass('block');
    expect(await screen.findByText(/no submissions yet/i)).toBeInTheDocument();
    // The side-effect should have attempted to load /submissions when "mine" is selected.
    // We assert via call count (best-effort).
    expect(mySubmissionsCalls).toHaveBeenCalledTimes(1);
  });

  it('submissions control: toggles "Allow submissions" via PATCH /streamer/channel/settings', async () => {
    const userEv = userEvent.setup();
    const user = makeStreamerUser();

    const patchCalls: unknown[] = [];
    server.use(
      mockChannel(user.channel!.slug, { stats: { memesCount: 0 }, submissionsEnabled: true, submissionsOnlyWhenLive: false, dashboardCardOrder: null }),
      mockStreamerBots([]),
      mockStreamerSubmissions({ items: [], total: 0 }),
      mockMySubmissions([]),
      // Toggle switches save via this endpoint.
      // Use MSW directly to assert payload.
      http.patch('*/streamer/channel/settings', async ({ request }) => {
        patchCalls.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );

    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false } as any));

    renderWithProviders(<DashboardPage />, {
      route: '/dashboard',
      preloadedState: { auth: { user, loading: false, error: null } } as any,
    });

    // Open submissions control expandable card.
    const submissionsTitles = await screen.findAllByText(/^submissions$/i);
    const submissionsCardTitle = submissionsTitles.find((el) => !!el.closest('[role="button"]')) ?? null;
    expect(submissionsCardTitle).toBeTruthy();
    const submissionsCard = submissionsCardTitle!.closest('[role="button"]') as HTMLElement | null;
    expect(submissionsCard).toBeTruthy();
    await userEv.click(submissionsCard!);

    // Toggle should be checked initially (enabled).
    const allowToggle = screen.getByRole('checkbox', { name: /allow submissions/i });
    expect(allowToggle).toBeChecked();

    await userEv.click(allowToggle);

    // PATCH should have been sent with submissionsEnabled: false (best-effort).
    expect(patchCalls.length).toBeGreaterThanOrEqual(1);
    expect(patchCalls.some((b: any) => b && b.submissionsEnabled === false)).toBe(true);
  });

  it('submissions control: toggles meme catalog mode via PATCH /streamer/channel/settings', async () => {
    const userEv = userEvent.setup();
    const user = makeStreamerUser();

    const patchCalls: unknown[] = [];
    server.use(
      mockChannel(user.channel!.slug, {
        stats: { memesCount: 0 },
        submissionsEnabled: true,
        submissionsOnlyWhenLive: false,
        memeCatalogMode: 'channel',
        dashboardCardOrder: null,
      }),
      mockStreamerBots([]),
      mockStreamerSubmissions({ items: [], total: 0 }),
      mockMySubmissions([]),
      http.patch('*/streamer/channel/settings', async ({ request }) => {
        patchCalls.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );

    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false } as any));

    renderWithProviders(<DashboardPage />, {
      route: '/dashboard',
      preloadedState: { auth: { user, loading: false, error: null } } as any,
    });

    // Open submissions control expandable card.
    const submissionsTitles = await screen.findAllByText(/^submissions$/i);
    const submissionsCardTitle = submissionsTitles.find((el) => !!el.closest('[role="button"]')) ?? null;
    expect(submissionsCardTitle).toBeTruthy();
    const submissionsCard = submissionsCardTitle!.closest('[role="button"]') as HTMLElement | null;
    expect(submissionsCard).toBeTruthy();
    await userEv.click(submissionsCard!);

    // Toggle should be OFF initially (channel-only).
    const catalogToggle = screen.getByRole('checkbox', { name: /show all pool memes on channel page/i });
    expect(catalogToggle).not.toBeChecked();

    await userEv.click(catalogToggle);

    expect(patchCalls.length).toBeGreaterThanOrEqual(1);
    expect(patchCalls.some((b: any) => b && b.memeCatalogMode === 'pool_all')).toBe(true);
  });

  it('submissions control: rotates link and renders returned links + status', async () => {
    const userEv = userEvent.setup();
    const user = makeStreamerUser();

    const rotateCalls: string[] = [];
    server.use(
      mockChannel(user.channel!.slug, { stats: { memesCount: 0 }, submissionsEnabled: true, submissionsOnlyWhenLive: false, dashboardCardOrder: null }),
      mockStreamerBots([]),
      mockStreamerSubmissions({ items: [], total: 0 }),
      mockMySubmissions([]),
      http.post('*/streamer/submissions-control/link/rotate', ({ request }) => {
        rotateCalls.push(request.method);
        return HttpResponse.json({
          token: 'tok_1',
          url: 'https://example.com/control',
        });
      }),
      http.get('*/public/submissions/status*', ({ request }) => {
        void request;
        return HttpResponse.json({ enabled: true, channelSlug: user.channel!.slug });
      }),
    );

    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false } as any));

    renderWithProviders(<DashboardPage />, {
      route: '/dashboard',
      preloadedState: { auth: { user, loading: false, error: null } } as any,
    });

    const submissionsTitles = await screen.findAllByText(/^submissions$/i);
    const submissionsCardTitle = submissionsTitles.find((el) => !!el.closest('[role="button"]')) ?? null;
    expect(submissionsCardTitle).toBeTruthy();
    const submissionsCard = submissionsCardTitle!.closest('[role="button"]') as HTMLElement | null;
    expect(submissionsCard).toBeTruthy();
    await userEv.click(submissionsCard!);

    await userEv.click(screen.getByRole('button', { name: /rotate/i }));

    expect(rotateCalls).toEqual(['POST']);

    expect(await screen.findByTestId('secret:Control link')).toHaveTextContent('https://example.com/control');
    expect(screen.getByTestId('secret:Token (one-time)')).toHaveTextContent('tok_1');
  });

  it('bots: "Disable all" patches each provider', async () => {
    const userEv = userEvent.setup();
    const user = makeStreamerUser();

    const patched: string[] = [];
    server.use(
      mockChannel(user.channel!.slug, { stats: { memesCount: 0 }, submissionsEnabled: true, submissionsOnlyWhenLive: false, dashboardCardOrder: null }),
      mockStreamerBots([{ provider: 'twitch', enabled: true }, { provider: 'youtube', enabled: true }] as any),
      mockStreamerSubmissions({ items: [], total: 0 }),
      mockMySubmissions([]),
      http.patch('*/streamer/bots/:provider', ({ params, request }) => {
        void request;
        patched.push(String(params.provider));
        return HttpResponse.json({ ok: true });
      }),
    );

    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false } as any));

    renderWithProviders(<DashboardPage />, {
      route: '/dashboard',
      preloadedState: { auth: { user, loading: false, error: null } } as any,
    });

    // Open bots expandable card.
    await userEv.click(await screen.findByRole('button', { name: /bots/i }));

    const disableAllBtn = screen
      .getAllByRole('button', { name: /disable all/i })
      .find((el) => el.tagName === 'BUTTON') as HTMLButtonElement | undefined;
    expect(disableAllBtn).toBeTruthy();
    await userEv.click(disableAllBtn!);

    // Should patch each unique provider.
    expect(patched.sort()).toEqual(['twitch', 'youtube']);
  });
});
