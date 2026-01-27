import { describe, expect, it } from 'vitest';

import reducer, { fetchBotStatuses, updateBotSettingsThunk } from './botIntegrationSlice';

import type { BotStatus } from '@/shared/api/bot';

const sampleBot = (overrides: Partial<BotStatus> = {}): BotStatus => ({
  provider: 'twitch',
  enabled: true,
  useDefaultBot: false,
  customBotLinked: true,
  ...overrides,
});

describe('botIntegrationSlice reducer', () => {
  it('has expected initial state', () => {
    const state = reducer(undefined, { type: 'init' });
    expect(state).toEqual({ bots: [], loading: false, error: null });
  });

  it('fetchBotStatuses.fulfilled replaces bots and clears loading', () => {
    const prev = reducer(undefined, fetchBotStatuses.pending('req1', undefined));
    const next = reducer(prev, fetchBotStatuses.fulfilled({ bots: [sampleBot()] }, 'req1', undefined));
    expect(next.loading).toBe(false);
    expect(next.bots).toHaveLength(1);
  });

  it('updateBotSettingsThunk.fulfilled upserts bot status', () => {
    const prev = reducer(undefined, { type: 'init' });
    const next = reducer(prev, updateBotSettingsThunk.fulfilled(sampleBot({ provider: 'vkvideo' }), 'req1', {
      provider: 'vkvideo',
      settings: { enabled: true },
    }));
    expect(next.bots[0]).toMatchObject({ provider: 'vkvideo' });
  });
});
