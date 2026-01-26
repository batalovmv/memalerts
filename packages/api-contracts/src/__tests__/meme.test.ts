import { describe, expect, it } from 'vitest';

import { MemeDetailSchema, MemeListItemSchema } from '../entities/meme';

describe('MemeListItemSchema', () => {
  it('validates a valid meme list item', () => {
    const validMeme = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      title: 'Test Meme',
      type: 'video',
      fileUrl: 'https://example.com/meme.mp4',
      previewUrl: null,
      variants: [],
      priceCoins: 100,
      durationMs: 5000,
      activationsCount: 42,
      createdAt: '2024-01-01T00:00:00.000Z',
    };

    const result = MemeListItemSchema.safeParse(validMeme);
    expect(result.success).toBe(true);
  });

  it('rejects a meme without fileUrl', () => {
    const invalidMeme = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      title: 'Test Meme',
      type: 'video',
    };

    const result = MemeListItemSchema.safeParse(invalidMeme);
    expect(result.success).toBe(false);
  });
});

describe('MemeDetailSchema', () => {
  it('accepts detail-specific fields when present', () => {
    const validDetail = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      title: 'Detail Meme',
      type: 'video',
      fileUrl: 'https://example.com/meme.mp4',
      previewUrl: null,
      variants: [],
      priceCoins: 10,
      durationMs: 1200,
      activationsCount: 0,
      createdAt: '2024-01-01T00:00:00.000Z',
      status: 'approved',
      tags: [
        {
          id: '123e4567-e89b-12d3-a456-426614174111',
          name: 'funny',
        },
      ],
    };

    const result = MemeDetailSchema.safeParse(validDetail);
    expect(result.success).toBe(true);
  });
});
