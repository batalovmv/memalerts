import { describe, expect, it } from 'vitest';

import {
  extractFirstMentionIdFromParts,
  extractVkVideoChannelPointsRedemption,
  extractVkVideoFollowOrSubscriptionAlert,
} from '../../src/bots/vkvideoRewardUtils.js';

describe('vkvideo reward utils', () => {
  it('extracts first mention id from parts', () => {
    const id = extractFirstMentionIdFromParts([
      { mention: { id: 'user-1' } },
      { mention: { id: 'user-2' } },
    ]);
    expect(id).toBe('user-1');
  });

  it('extracts follow alerts', () => {
    const alert = extractVkVideoFollowOrSubscriptionAlert({
      type: 'follow',
      data: { event: { user: { id: 'u1' }, id: 'ev-1', created_at: '2025-01-01T00:00:00Z' } },
    });
    expect(alert).toEqual(
      expect.objectContaining({
        kind: 'follow',
        providerAccountId: 'u1',
        providerEventId: 'ev-1',
      })
    );
  });

  it('extracts channel points redemptions', () => {
    const redemption = extractVkVideoChannelPointsRedemption({
      type: 'channel_points',
      data: {
        redemption: {
          user: { id: 'u1' },
          amount: 50,
          reward: { id: 'reward-1' },
          id: 'red-1',
          created_at: '2025-01-01T00:00:00Z',
        },
      },
    });
    expect(redemption).toEqual(
      expect.objectContaining({
        providerAccountId: 'u1',
        amount: 50,
        rewardId: 'reward-1',
        providerEventId: 'red-1',
      })
    );
  });
});
