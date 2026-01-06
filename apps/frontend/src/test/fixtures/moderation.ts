import type { ModerationMemeAsset } from '@/shared/api/moderationMemeAssets';

export function makeModerationAsset(overrides: Partial<ModerationMemeAsset> = {}): ModerationMemeAsset {
  return {
    id: 'asset_1234567890abcdef',
    type: 'image',
    fileUrl: '/uploads/test.png',
    poolVisibility: 'hidden',
    purgeRequestedAt: null,
    purgedAt: null,
    fileHash: 'hash_1234567890abcdef',
    ...overrides,
  };
}














