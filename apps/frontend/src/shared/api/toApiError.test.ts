import { describe, expect, it } from 'vitest';

import { toApiError } from './toApiError';

describe('toApiError', () => {
  it('uses mapped message when errorCode is known and message missing', () => {
    const err = { response: { status: 403, data: { errorCode: 'SUBMISSIONS_DISABLED' } } };
    const res = toApiError(err, 'Fallback');
    expect(res.message).toBe('Submissions are disabled');
    expect(res.code).toBe('SUBMISSIONS_DISABLED');
    expect(res.statusCode).toBe(403);
  });

  it('prefers explicit message from response data', () => {
    const err = { response: { status: 400, data: { errorCode: 'BAD_REQUEST', message: 'Custom message' } } };
    const res = toApiError(err, 'Fallback');
    expect(res.message).toBe('Custom message');
  });

  it('falls back to provided message when code is unknown', () => {
    const err = { response: { status: 500, data: { errorCode: 'UNKNOWN_CODE' } } };
    const res = toApiError(err, 'Fallback');
    expect(res.message).toBe('Fallback');
    expect(res.code).toBe('INTERNAL_ERROR');
  });
});
