import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';

import { MySubmissionsSection } from './MySubmissionsSection';
import { renderWithProviders } from '@/test/test-utils';
import { makeMySubmission } from '@/test/fixtures/submissions';

vi.mock('./NeedsChangesSubmissionCard', () => ({
  NeedsChangesSubmissionCard: function NeedsChangesSubmissionCardMock(props: { submission: { id: string; title: string } }) {
    return <div data-testid="needs-changes-card">{props.submission.title}</div>;
  },
}));

describe('MySubmissionsSection (integration)', () => {
  it('renders empty state for needs_changes mode', () => {
    const onRefresh = vi.fn();
    renderWithProviders(
      <MySubmissionsSection
        mode="needs_changes"
        submissions={[]}
        loading={false}
        onRefresh={onRefresh}
        title="Needs changes"
      />,
    );

    expect(screen.getByText(/nothing to fix/i)).toBeTruthy();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('refresh button calls onRefresh and is disabled while loading', async () => {
    const userEv = userEvent.setup();
    const onRefresh = vi.fn();

    const { rerender } = renderWithProviders(
      <MySubmissionsSection
        mode="history"
        submissions={[makeMySubmission({ status: 'approved', title: 'Approved one' })]}
        loading={false}
        onRefresh={onRefresh}
        title="My submissions"
      />,
    );

    await userEv.click(screen.getByRole('button', { name: /refresh|retry/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(
      <MySubmissionsSection
        mode="history"
        submissions={[makeMySubmission({ status: 'approved', title: 'Approved one' })]}
        loading
        onRefresh={onRefresh}
        title="My submissions"
      />,
    );

    expect(screen.getByRole('button', { name: /refresh|retry/i })).toBeDisabled();
  });

  it('renders NeedsChangesSubmissionCard when item is needs_changes, even in history mode', () => {
    const onRefresh = vi.fn();
    renderWithProviders(
      <MySubmissionsSection
        mode="history"
        submissions={[
          makeMySubmission({ id: 'a', status: 'needs_changes', title: 'Fix me' }),
          makeMySubmission({ id: 'b', status: 'approved', title: 'Ok' }),
        ]}
        loading={false}
        onRefresh={onRefresh}
        title="My submissions"
      />,
    );

    const cards = screen.getAllByTestId('needs-changes-card');
    expect(cards).toHaveLength(1);
    expect(screen.getByText('Fix me')).toBeTruthy();
    expect(screen.getByText(/approved/i)).toBeTruthy();
  });
});












