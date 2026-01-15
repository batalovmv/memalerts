import { describe, expect, it } from 'vitest';
import { createRepositoryContextMock } from './mocks/repositories.js';
import { createSubmissionService } from '../src/services/SubmissionService.js';

describe('SubmissionService', () => {
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

  it('create returns 400 when file missing', async () => {
    const deps = createRepositoryContextMock();
    const req = { file: undefined } as any;
    const res = createRes();

    await createSubmissionService(deps).create(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      errorCode: 'BAD_REQUEST',
      error: 'Bad request',
      details: { field: 'file' },
    });
  });

  it('approve returns 400 when channelId missing', async () => {
    const deps = createRepositoryContextMock();
    const req = { params: { id: 'submission-1' }, channelId: undefined } as any;
    const res = createRes();

    await createSubmissionService(deps).approve(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Channel ID required' });
  });
});
