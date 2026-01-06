import type { MySubmission } from '@/features/submit/types';

export function makeMySubmission(overrides: Partial<MySubmission> = {}): MySubmission {
  return {
    id: 'sub_1',
    title: 'My meme',
    status: 'needs_changes',
    sourceKind: 'upload',
    memeAssetId: null,
    createdAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
    notes: null,
    moderatorNotes: 'other::Please add tags',
    revision: 0,
    tags: [],
    submitterId: 'u1',
    submitterDisplayName: 'User',
    ...overrides,
  };
}














