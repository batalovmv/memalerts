import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { CreditsOverlaySettings } from './CreditsOverlaySettings';
import { renderWithProviders } from '@/test/test-utils';

describe('CreditsOverlaySettings', () => {
  it('renders children and saving overlay', () => {
    renderWithProviders(
      <CreditsOverlaySettings
        isLoading
        isSaving={false}
        savedPulse={false}
        savingLabel="Saving..."
        savedLabel="Saved"
      >
        <div>Credits body</div>
      </CreditsOverlaySettings>,
    );

    expect(screen.getByText('Credits body')).toBeInTheDocument();
    expect(screen.getByText('Saving...')).toBeInTheDocument();
  });

  it('renders saved overlay when pulse is active', () => {
    renderWithProviders(
      <CreditsOverlaySettings
        isLoading={false}
        isSaving={false}
        savedPulse
        savingLabel="Saving..."
        savedLabel="Saved"
      >
        <div>Credits body</div>
      </CreditsOverlaySettings>,
    );

    expect(screen.getByText('Saved')).toBeInTheDocument();
  });
});
