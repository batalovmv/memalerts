import { afterEach, describe, expect, it, vi } from 'vitest';

import { BoostyApiClient } from '../src/utils/boostyApi.js';

describe('BoostyApiClient tierKey extraction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts tierKey from level.id when present', async () => {
    const payload = {
      data: [
        {
          id: 'sub_1',
          blog: { urlName: 'someblog' },
          is_active: true,
          level: { id: 'level_123', name: 'Gold' },
        },
      ],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(payload),
        } as unknown as Response;
      })
    );

    const client = new BoostyApiClient({ baseUrl: 'https://api.boosty.to', auth: { accessToken: 'token' } });
    const subs = await client.getUserSubscriptions({ limit: 1, withFollow: false });

    expect(subs).toHaveLength(1);
    expect(subs[0]?.blogName).toBe('someblog');
    expect(subs[0]?.tierKey).toBe('level_123');
    expect(subs[0]?.isActive).toBe(true);
  });
});
