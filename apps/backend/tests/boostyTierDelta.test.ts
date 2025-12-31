import { describe, expect, it } from 'vitest';

import { __test__computeBoostyTierDelta } from '../src/jobs/boostySubscriptionRewards.js';

describe('boosty boosty_api tier delta rules', () => {
  it('upgrade: pays only delta', () => {
    const r = __test__computeBoostyTierDelta({
      tierKeyGranted: 'tier1',
      tierKeyCurrent: 'tier2',
      coinsGranted: 100,
      targetCoins: 250,
    });
    expect(r.delta).toBe(150);
    expect(r.nextCoinsGranted).toBe(250);
    expect(r.nextTierKeyGranted).toBe('tier2');
  });

  it('repeat same tier: pays nothing (even if targetCoins increased by config)', () => {
    const r = __test__computeBoostyTierDelta({
      tierKeyGranted: 'tier2',
      tierKeyCurrent: 'tier2',
      coinsGranted: 250,
      targetCoins: 300,
    });
    expect(r.delta).toBe(0);
    expect(r.nextCoinsGranted).toBe(250);
    expect(r.nextTierKeyGranted).toBeNull();
  });

  it('sameTier + config increased: never retro-pays', () => {
    const r = __test__computeBoostyTierDelta({
      tierKeyGranted: 'tier1',
      tierKeyCurrent: 'tier1',
      coinsGranted: 100,
      targetCoins: 250,
    });
    expect(r.delta).toBe(0);
    expect(r.nextCoinsGranted).toBe(100);
    expect(r.nextTierKeyGranted).toBeNull();
  });

  it('tier key changes but coins are the same: pays nothing and does NOT update granted tierKey', () => {
    const r = __test__computeBoostyTierDelta({
      tierKeyGranted: 'tier-old',
      tierKeyCurrent: 'tier-new',
      coinsGranted: 250,
      targetCoins: 250,
    });
    expect(r.delta).toBe(0);
    expect(r.nextCoinsGranted).toBe(250);
    expect(r.nextTierKeyGranted).toBeNull();
  });

  it('downgrade (targetCoins < coinsGranted): pays nothing, keeps coinsGranted, does not update tierKey', () => {
    const r = __test__computeBoostyTierDelta({
      tierKeyGranted: 'tier2',
      tierKeyCurrent: 'tier1',
      coinsGranted: 250,
      targetCoins: 100,
    });
    expect(r.delta).toBe(0);
    expect(r.nextCoinsGranted).toBe(250);
    expect(r.nextTierKeyGranted).toBeNull();
  });

  it('fallback-only (tierKeyCurrent=null): allows first payout without inventing tierKey', () => {
    const r = __test__computeBoostyTierDelta({
      tierKeyGranted: null,
      tierKeyCurrent: null,
      coinsGranted: 0,
      targetCoins: 100,
    });
    expect(r.delta).toBe(100);
    expect(r.nextCoinsGranted).toBe(100);
    expect(r.nextTierKeyGranted).toBeNull();
  });

  it('fallback-only repeat: does not pay again when coinsGranted already > 0', () => {
    const r = __test__computeBoostyTierDelta({
      tierKeyGranted: null,
      tierKeyCurrent: null,
      coinsGranted: 100,
      targetCoins: 100,
    });
    expect(r.delta).toBe(0);
    expect(r.nextCoinsGranted).toBe(100);
    expect(r.nextTierKeyGranted).toBeNull();
  });
});


