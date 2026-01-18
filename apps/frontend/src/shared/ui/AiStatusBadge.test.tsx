import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/test/test-utils';
import { AiStatusBadge } from './AiStatusBadge';

describe('AiStatusBadge', () => {
  it('renders decision and status labels', () => {
    renderWithProviders(
      <div>
        <AiStatusBadge decision="high" status="processing" />
      </div>,
    );

    expect(screen.getByText('AI: high')).toBeInTheDocument();
    expect(screen.getByText('AI processing')).toBeInTheDocument();
  });

  it('uses statusLabel when provided', () => {
    renderWithProviders(
      <div>
        <AiStatusBadge decision="medium" status="failed_final" statusLabel="failed" />
      </div>,
    );

    expect(screen.getByText('AI: medium')).toBeInTheDocument();
    expect(screen.getByText('AI failed')).toBeInTheDocument();
  });
});
