import { describe, expect, it } from 'vitest';

import { __test__normalizeTierCoins, __test__pickCoinsForTier } from '../src/jobs/boostySubscriptionRewards.js';

describe('boosty boosty_api tier->coins matching', () => {
  it('normalizes array mapping and filters invalid entries', () => {
    expect(__test__normalizeTierCoins(null)).toEqual([]);
    expect(__test__normalizeTierCoins({})).toEqual([]);

    const normalized = __test__normalizeTierCoins([
      { tierKey: 'tier1', coins: 100 },
      { tierKey: ' ', coins: 200 },
      { tierKey: 'tier2', coins: -1 },
      { tierKey: 'tier3', coins: 250.8 },
    ]);

    expect(normalized).toEqual([
      { tierKey: 'tier1', coins: 100 },
      { tierKey: 'tier3', coins: 250 },
    ]);
  });

  it('normalizes object mapping', () => {
    const normalized = __test__normalizeTierCoins({ tier1: 100, tier2: 250 });
    expect(normalized).toEqual([
      { tierKey: 'tier1', coins: 100 },
      { tierKey: 'tier2', coins: 250 },
    ]);
  });

  it('trims + lowercases tierKey in config', () => {
    const tierCoins = __test__normalizeTierCoins([{ tierKey: ' TIER-2 ', coins: 250 }]);
    expect(tierCoins).toEqual([{ tierKey: 'tier-2', coins: 250 }]);

    expect(__test__pickCoinsForTier({ tierKey: 'tier-2', tierCoins, fallbackCoins: 10 })).toBe(250);
    expect(__test__pickCoinsForTier({ tierKey: 'TIER-2', tierCoins, fallbackCoins: 10 })).toBe(250);
  });

  it('picks coins by tierKey with fallback', () => {
    const tierCoins = [
      { tierKey: 'lvl_1', coins: 100 },
      { tierKey: 'tier-2', coins: 250 },
    ];

    expect(__test__pickCoinsForTier({ tierKey: 'lvl_1', tierCoins, fallbackCoins: 10 })).toBe(100);
    expect(__test__pickCoinsForTier({ tierKey: 'Tier-2', tierCoins, fallbackCoins: 10 })).toBe(250); // normalized
    expect(__test__pickCoinsForTier({ tierKey: 'unknown', tierCoins, fallbackCoins: 10 })).toBe(10);
    expect(__test__pickCoinsForTier({ tierKey: null, tierCoins, fallbackCoins: 10 })).toBe(10);
  });
});


