import type { MemeDetail, Tag } from '@memalerts/api-contracts';

export function makeTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: 'tag_1',
    name: 'fun',
    ...overrides,
  };
}

export function makeMeme(overrides: Partial<MemeDetail> = {}): MemeDetail {
  return {
    id: 'meme_1',
    title: 'Meme',
    type: 'video',
    fileUrl: 'https://example.com/meme.webm',
    previewUrl: null,
    variants: [],
    priceCoins: 100,
    durationMs: 1000,
    activationsCount: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    channelId: 'c1',
    tags: [{ tag: makeTag() }],
    ...overrides,
  };
}





















