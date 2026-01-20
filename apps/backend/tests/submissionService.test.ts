import { describe, expect, it } from 'vitest';
import type { Response } from 'express';
import type { AuthRequest } from '../src/middleware/auth.js';
import { createRepositoryContextMock } from './mocks/repositories.js';
import { createSubmissionService } from '../src/services/SubmissionService.js';

describe('SubmissionService', () => {
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

  it('create returns 400 when file missing', async () => {
    const deps = createRepositoryContextMock();
    const req: Partial<AuthRequest> = { file: undefined };
    const res = createRes();

    await createSubmissionService(deps).create(req as AuthRequest, res as unknown as Response);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      errorCode: 'BAD_REQUEST',
      error: 'Bad request',
      details: { field: 'file' },
    });
  });

  it('approve returns 400 when channelId missing', async () => {
    const deps = createRepositoryContextMock();
    const req: Partial<AuthRequest> = { params: { id: 'submission-1' }, channelId: undefined };
    const res = createRes();

    await createSubmissionService(deps).approve(req as AuthRequest, res as unknown as Response);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Channel ID required' });
  });
});
