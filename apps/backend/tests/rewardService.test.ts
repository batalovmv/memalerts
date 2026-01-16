import { describe, expect, it, vi } from 'vitest';
import {
  recordExternalRewardEventTx,
  stableProviderEventId,
  type ExternalRewardTx,
} from '../src/services/RewardService.js';

describe('RewardService', () => {
  it('stableProviderEventId is deterministic', () => {
    const first = stableProviderEventId({
      provider: 'twitch',
      rawPayloadJson: '{"a":1}',
      fallbackParts: ['user', 'event'],
    });
    const second = stableProviderEventId({
      provider: 'twitch',
      rawPayloadJson: '{"a":1}',
      fallbackParts: ['user', 'event'],
    });
    const different = stableProviderEventId({
      provider: 'twitch',
      rawPayloadJson: '{"a":2}',
      fallbackParts: ['user', 'event'],
    });

    expect(first).toBe(second);
    expect(first).not.toBe(different);
  });

  it('recordExternalRewardEventTx skips when identifiers missing', async () => {
    const tx = {
      externalRewardEvent: { upsert: vi.fn() },
      pendingCoinGrant: { createMany: vi.fn() },
    } as unknown as ExternalRewardTx;

    const res = await recordExternalRewardEventTx({
      tx,
      provider: 'twitch',
      providerEventId: '',
      channelId: '',
      providerAccountId: '',
      eventType: 'twitch_follow',
      currency: 'twitch_channel_points',
      amount: 10,
      coinsToGrant: 10,
      status: 'eligible',
      rawPayloadJson: '{}',
    });

    expect(res).toEqual({ ok: false, externalEventId: null, createdPending: false });
    expect(tx.externalRewardEvent.upsert).not.toHaveBeenCalled();
  });

  it('recordExternalRewardEventTx creates pending grant when eligible', async () => {
    const tx = {
      externalRewardEvent: { upsert: vi.fn().mockResolvedValue({ id: 'evt1' }) },
      pendingCoinGrant: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    } as unknown as ExternalRewardTx;

    const res = await recordExternalRewardEventTx({
      tx,
      provider: 'twitch',
      providerEventId: 'event-1',
      channelId: 'channel-1',
      providerAccountId: 'account-1',
      eventType: 'twitch_follow',
      currency: 'twitch_channel_points',
      amount: 10,
      coinsToGrant: 25,
      status: 'eligible',
      rawPayloadJson: '{"ok":true}',
    });

    expect(res).toEqual({ ok: true, externalEventId: 'evt1', createdPending: true });
    expect(tx.externalRewardEvent.upsert).toHaveBeenCalledTimes(1);
    expect(tx.pendingCoinGrant.createMany).toHaveBeenCalledTimes(1);
  });
});
