import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';

import SubmitPage from './SubmitPage';
import { renderWithProviders } from '@/test/test-utils';
import { server } from '@/test/msw/server';
import { mockMySubmissions } from '@/test/msw/handlers';
import { makeViewerUser } from '@/test/fixtures/user';

vi.mock('@/components/Header', () => ({
  default: function HeaderMock() {
    return <div data-testid="header" />;
  },
}));

vi.mock('./components/NeedsChangesSubmissionCard', () => ({
  NeedsChangesSubmissionCard: function NeedsChangesSubmissionCardMock(props: { submission: { id: string; title: string } }) {
    return <div data-testid="needs-changes-card">{props.submission.title}</div>;
  },
}));

describe('SubmitPage (integration)', () => {
  it('loads /submissions on mount, filters by submitterId and status=needs_changes, and refresh triggers reload', async () => {
    const userEv = userEvent.setup();
    const me = makeViewerUser({ id: 'u1' });

    let calls = 0;
    server.use(
      mockMySubmissions(
        [
          {
            id: 's1',
            title: 'Needs changes - mine',
            status: 'needs_changes',
            createdAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
            revision: 0,
            tags: [{ tag: { name: 't1' } }],
            submitter: { id: 'u1', displayName: 'Me' },
          },
          {
            id: 's2',
            title: 'Needs changes - other',
            status: 'needs_changes',
            createdAt: new Date('2025-01-02T00:00:00.000Z').toISOString(),
            revision: 0,
            tags: [],
            submitter: { id: 'u2', displayName: 'Other' },
          },
          {
            id: 's3',
            title: 'Approved - mine',
            status: 'approved',
            createdAt: new Date('2025-01-03T00:00:00.000Z').toISOString(),
            revision: 0,
            tags: [],
            submitter: { id: 'u1', displayName: 'Me' },
          },
        ],
        () => {
          calls += 1;
        },
      ),
    );

    renderWithProviders(<SubmitPage />, {
      route: '/submit',
      preloadedState: { auth: { user: me, loading: false, error: null } } as any,
    });

    await waitFor(() => expect(calls).toBe(1));

    // Only the mine + needs_changes submission should render.
    await waitFor(() => expect(screen.getAllByTestId('needs-changes-card')).toHaveLength(1));
    expect(screen.getByText('Needs changes - mine')).toBeTruthy();
    expect(screen.queryByText('Needs changes - other')).toBeNull();
    expect(screen.queryByText('Approved - mine')).toBeNull();

    await userEv.click(screen.getByRole('button', { name: /refresh|retry/i }));
    await waitFor(() => expect(calls).toBe(2));
  });
});














