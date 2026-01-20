import type { CreditsState } from '@/shared/api/creditsOverlay';
import type { CreditsEntry } from '@/types';

export function makeCreditsEntry(overrides: Partial<CreditsEntry> = {}): CreditsEntry {
  return {
    displayName: 'Donor',
    amount: 100,
    message: 'Thanks!',
    ...overrides,
  };
}

export function makeCreditsState(overrides: Partial<CreditsState> = {}): CreditsState {
  return {
    donors: [makeCreditsEntry()],
    chatters: [],
    ...overrides,
  };
}

export function makeCreditsToken(overrides: Partial<{ token: string; url: string }> = {}) {
  return {
    token: 'tok1',
    url: 'https://example.com/overlay/credits/t/tok1',
    ...overrides,
  };
}
