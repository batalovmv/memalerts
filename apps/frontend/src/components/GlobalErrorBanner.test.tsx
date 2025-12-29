import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';

import GlobalErrorBanner from './GlobalErrorBanner';
import { renderWithProviders } from '@/test/test-utils';

describe('GlobalErrorBanner (integration)', () => {
  it('hides requestId inline on non-beta hostname (shows Details button)', async () => {
    renderWithProviders(<GlobalErrorBanner />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('memalerts:globalError', {
          detail: {
            kind: 'api',
            message: 'Boom',
            requestId: 'req_123',
            status: 500,
            path: '/me',
            method: 'GET',
          },
        }),
      );
    });

    expect(await screen.findByText(/boom/i)).toBeInTheDocument();
    expect(screen.queryByText(/error id/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /details/i })).toBeInTheDocument();
  });
});


