import { describe, expect, it } from 'vitest';
import { createMemeService } from '../src/services/MemeService.js';

describe('MemeService', () => {
  const createRes = () => {
    const res = {
      statusCode: 200,
      body: null as any,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    return res;
  };

  it('getMemes returns 400 when channelId missing', async () => {
    const req = { channelId: undefined, query: {} } as any;
    const res = createRes();

    await createMemeService().getMemes(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Channel ID required' });
  });

  it('deleteMeme returns 400 when channelId missing', async () => {
    const req = { channelId: undefined, params: { id: 'meme-1' } } as any;
    const res = createRes();

    await createMemeService().deleteMeme(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Channel ID required' });
  });
});
