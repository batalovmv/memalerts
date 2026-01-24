import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { DashboardSubmissionsPanel } from '../ui/panels/submissions/DashboardSubmissionsPanel';
import { renderWithProviders } from '@/test/test-utils';
import { installIntersectionObserverOncePerElement } from '@/test/helpers';
import type { Submission } from '@/types';

function makeSubmission(id: string): Submission {
  return {
    id,
    title: `Submission ${id}`,
    type: 'video',
    fileUrlTemp: 'https://example.com/video.webm',
    notes: null,
    status: 'pending',
    submitter: { id: 'u1', displayName: 'User' },
    createdAt: new Date().toISOString(),
  };
}

function renderPanel(override?: Partial<React.ComponentProps<typeof DashboardSubmissionsPanel>>) {
  const props: React.ComponentProps<typeof DashboardSubmissionsPanel> = {
    isOpen: true,
    activeTab: 'pending',
    onTabChange: vi.fn(),
    submissions: [makeSubmission('s1')],
    submissionsLoading: false,
    submissionsLoadingMore: false,
    pendingError: null,
    pendingCount: 1,
    total: 1,
    pendingFilters: {
      status: 'all',
      aiStatus: 'all',
      q: '',
      sort: 'newest-first',
    },
    onPendingFiltersChange: vi.fn(),
    onLoadMorePending: vi.fn(),
    onRetryPending: vi.fn(),
    onApprove: vi.fn(),
    onNeedsChanges: vi.fn(),
    onReject: vi.fn(),
    mySubmissions: [],
    mySubmissionsLoading: false,
    onRefreshMySubmissions: vi.fn(),
    onClose: vi.fn(),
    ...(override ?? {}),
  };

  return renderWithProviders(<DashboardSubmissionsPanel {...props} />, {
    preloadedState: { auth: { user: null, loading: false, error: null } },
  });
}

describe('Moderation hotkeys', () => {
  let restoreIntersectionObserver: (() => void) | null = null;
  let originalScrollIntoView: PropertyDescriptor | undefined;

  beforeEach(() => {
    restoreIntersectionObserver = installIntersectionObserverOncePerElement();
    originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView',
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    restoreIntersectionObserver?.();
    restoreIntersectionObserver = null;
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
    } else {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
    originalScrollIntoView = undefined;
  });

  it('approves on Enter key', async () => {
    const onApprove = vi.fn();
    renderPanel({ onApprove });

    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() => expect(onApprove).toHaveBeenCalledWith('s1'));
  });

  it('ignores hotkeys when input focused', async () => {
    const onApprove = vi.fn();
    renderPanel({ onApprove });

    const input = screen.getByPlaceholderText(/search/i);
    input.focus();

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onApprove).not.toHaveBeenCalled());
  });
});
