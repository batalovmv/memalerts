import { describe, expect, it } from 'vitest';

import { __test__normalizeTierRoles, __test__pickMatchedTierRole } from '../src/jobs/boostySubscriptionRewards.js';

describe('boosty discord tier role matching', () => {
  it('handles empty/invalid JSON as empty mapping', () => {
    expect(__test__normalizeTierRoles(null)).toEqual([]);
    expect(__test__normalizeTierRoles({})).toEqual([]);
    expect(__test__normalizeTierRoles('x')).toEqual([]);
  });

  it('matches any tier role (first match wins)', () => {
    const tierRoles = [
      { tier: 'tier1', roleId: 'r1' },
      { tier: 'tier2', roleId: 'r2' },
    ];
    const memberRoles = ['x', 'r2', 'r1'];
    // order matters: we pick first tierRoles entry that exists in memberRoles
    const matched = __test__pickMatchedTierRole({ memberRoles, tierRoles });
    expect(matched).toEqual({ tier: 'tier1', roleId: 'r1' });
  });

  it('returns null when no tier roles present', () => {
    const tierRoles = [{ tier: 'tier1', roleId: 'r1' }];
    const memberRoles = ['x', 'y'];
    const matched = __test__pickMatchedTierRole({ memberRoles, tierRoles });
    expect(matched).toBeNull();
  });
});


