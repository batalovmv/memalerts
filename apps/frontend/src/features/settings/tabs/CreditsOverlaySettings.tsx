import type { ReactNode } from 'react';

import { SavedOverlay, SavingOverlay } from '@/shared/ui';

export type CreditsOverlaySettingsProps = {
  isLoading: boolean;
  isSaving: boolean;
  savedPulse: boolean;
  savingLabel: string;
  savedLabel: string;
  children: ReactNode;
};

export function CreditsOverlaySettings({
  isLoading,
  isSaving,
  savedPulse,
  savingLabel,
  savedLabel,
  children,
}: CreditsOverlaySettingsProps) {
  return (
    <div className="glass p-4 space-y-4">
      {(isLoading || isSaving) && <SavingOverlay label={savingLabel} />}
      {savedPulse && !isSaving && !isLoading && <SavedOverlay label={savedLabel} />}
      {children}
    </div>
  );
}
