import { describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { createPoolSubmission } from '@/shared/api/submissions';

describe('createPoolSubmission', () => {
  it('posts normalized pool submission payload', async () => {
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({});

    await createPoolSubmission({
      memeAssetId: 'asset-1',
      title: '  Title ',
      notes: ' Notes ',
      tags: ['t1', ' ', ' t2 '],
      channelId: ' channel-1 ',
    });

    expect(postSpy).toHaveBeenCalledWith(
      '/submissions/pool',
      {
        memeAssetId: 'asset-1',
        title: 'Title',
        notes: 'Notes',
        tags: ['t1', 't2'],
        channelId: 'channel-1',
      },
      { timeout: 15000 },
    );

    postSpy.mockRestore();
  });
});
