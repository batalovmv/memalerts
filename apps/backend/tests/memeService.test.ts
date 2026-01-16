import { describe, expect, it } from 'vitest';
import type { Response } from 'express';
import type { AuthRequest } from '../src/middleware/auth.js';
import { createMemeService } from '../src/services/MemeService.js';

describe('MemeService', () => {
  type TestResponse = {
    statusCode: number;
    body: unknown;
    status: (code: number) => TestResponse;
    json: (payload: unknown) => TestResponse;
  };

  const createRes = (): TestResponse => ({
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  });

  it('getMemes returns 400 when channelId missing', async () => {
    const req: Partial<AuthRequest> = { channelId: undefined, query: {} };
    const res = createRes();

    await createMemeService().getMemes(req as AuthRequest, res as unknown as Response);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Channel ID required' });
  });

  it('deleteMeme returns 400 when channelId missing', async () => {
    const req: Partial<AuthRequest> = { channelId: undefined, params: { id: 'meme-1' } };
    const res = createRes();

    await createMemeService().deleteMeme(req as AuthRequest, res as unknown as Response);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Channel ID required' });
  });
});
