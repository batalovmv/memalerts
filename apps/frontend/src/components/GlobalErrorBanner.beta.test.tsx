// @vitest-environment-options {"url":"https://beta.example.com/"}

import React from 'react';
import { describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';

import GlobalErrorBanner from './GlobalErrorBanner';
import { renderWithProviders } from '@/test/test-utils';

describe('GlobalErrorBanner (beta hostname)', () => {
  it('shows requestId inline', async () => {
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
    expect(screen.getByText(/error id/i)).toBeInTheDocument();
    expect(screen.getByText('req_123')).toBeInTheDocument();
  });
});


