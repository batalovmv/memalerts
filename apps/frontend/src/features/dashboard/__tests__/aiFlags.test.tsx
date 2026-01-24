import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/test/test-utils';

describe('DashboardSubmissionsPanel runtime flags', () => {
  it('hides AI status filter when aiEnabled is false', async () => {
    vi.resetModules();
    window.__MEMALERTS_RUNTIME_CONFIG__ = { aiEnabled: false };

    const { DashboardSubmissionsPanel } = await import('../ui/panels/submissions/DashboardSubmissionsPanel');

    renderWithProviders(
      <DashboardSubmissionsPanel
        isOpen
        activeTab="pending"
        onTabChange={vi.fn()}
        submissions={[]}
        submissionsLoading={false}
        submissionsLoadingMore={false}
        pendingError={null}
        pendingCount={0}
        total={0}
        pendingFilters={{ status: 'all', aiStatus: 'all', q: '', sort: 'newest-first' }}
        onPendingFiltersChange={vi.fn()}
        onLoadMorePending={vi.fn()}
        onRetryPending={vi.fn()}
        onApprove={vi.fn()}
        onNeedsChanges={vi.fn()}
        onReject={vi.fn()}
        mySubmissions={[]}
        mySubmissionsLoading={false}
        onRefreshMySubmissions={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText(/AI status/i)).toBeNull();

    delete window.__MEMALERTS_RUNTIME_CONFIG__;
  });
});
