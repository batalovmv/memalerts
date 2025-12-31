import { describe, expect, it } from 'vitest';

import reducer, { clearError, clearMemes, fetchMemes } from './memesSlice';

import type { Meme } from '@/types';

describe('memesSlice reducer', () => {
  it('has expected initial state', () => {
    const state = reducer(undefined, { type: 'init' });
    expect(state).toEqual({ memes: [], loading: false, error: null });
  });

  it('clearMemes empties memes list', () => {
    const prev = { memes: [{ id: 'm1' } as Meme], loading: false, error: null };
    const next = reducer(prev, clearMemes());
    expect(next.memes).toEqual([]);
  });

  it('clearError resets error', () => {
    const prev = { memes: [], loading: false, error: 'x' };
    const next = reducer(prev, clearError());
    expect(next.error).toBeNull();
  });

  it('fetchMemes.fulfilled stores payload', () => {
    const prev = reducer(undefined, { type: 'init' });
    const payload: Meme[] = [
      { id: 'm1', title: 'A', type: 'gif', fileUrl: '/x', priceCoins: 1, durationMs: 1000 },
      { id: 'm2', title: 'B', type: 'image', fileUrl: '/y', priceCoins: 2, durationMs: 2000 },
    ];
    const next = reducer(prev, fetchMemes.fulfilled(payload, 'req1', { channelId: 'c1' }));
    expect(next.loading).toBe(false);
    expect(next.error).toBeNull();
    expect(next.memes).toEqual(payload);
  });
});









