import type { Meme, Tag } from '@/types';

export function makeTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: 'tag_1',
    name: 'fun',
    ...overrides,
  };
}

export function makeMeme(overrides: Partial<Meme> = {}): Meme {
  return {
    id: 'meme_1',
    title: 'Meme',
    type: 'video',
    fileUrl: 'https://example.com/meme.webm',
    priceCoins: 100,
    durationMs: 1000,
    channelId: 'c1',
    tags: [{ tag: makeTag() }],
    ...overrides,
  };
}














