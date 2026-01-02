import { describe, expect, it } from 'vitest';

import { getRequestIdFromError } from './api';

describe('getRequestIdFromError', () => {
  it('reads request id from response headers', () => {
    const err = {
      response: {
        headers: {
          'x-request-id': 'req_123',
        },
      },
    };
    expect(getRequestIdFromError(err)).toBe('req_123');
  });

  it('reads request id from response body', () => {
    const err = {
      response: {
        headers: {},
        data: { requestId: 'req_body_1' },
      },
    };
    expect(getRequestIdFromError(err)).toBe('req_body_1');
  });

  it('reads request id from attached top-level field', () => {
    const err = { requestId: 'req_attached_1' };
    expect(getRequestIdFromError(err)).toBe('req_attached_1');
  });

  it('returns null when nothing found', () => {
    expect(getRequestIdFromError({})).toBe(null);
    expect(getRequestIdFromError(null)).toBe(null);
    expect(getRequestIdFromError(undefined)).toBe(null);
  });
});












