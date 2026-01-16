import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { idempotencyKey } from '../src/middleware/idempotencyKey.js';

const baseEnv = { ...process.env };

type TestReq = {
  get: (name: string) => string | undefined;
  idempotencyKey?: string;
};

type TestRes = {
  statusCode: number;
  body?: unknown;
  status: (code: number) => TestRes;
  json: (body: unknown) => TestRes;
};

function makeReq(header?: string): TestReq {
  return {
    get: (name: string) => (name.toLowerCase() === 'idempotency-key' ? header : undefined),
  };
}

function makeRes(): TestRes {
  const res: TestRes = {
    statusCode: 200,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

beforeEach(() => {
  process.env = { ...baseEnv };
});

afterEach(() => {
  process.env = { ...baseEnv };
  vi.restoreAllMocks();
});

describe('middleware: idempotencyKey', () => {
  it('ignores missing or blank header', () => {
    const next = vi.fn();
    const reqMissing = makeReq(undefined);
    idempotencyKey(reqMissing as never, makeRes() as never, next);
    expect(next).toHaveBeenCalled();
    expect(reqMissing.idempotencyKey).toBeUndefined();

    const reqBlank = makeReq('   ');
    idempotencyKey(reqBlank as never, makeRes() as never, next);
    expect(reqBlank.idempotencyKey).toBeUndefined();
  });

  it('rejects overly long keys', () => {
    process.env.IDEMPOTENCY_KEY_MAX_LEN = '4';
    const req = makeReq('abcde');
    const res = makeRes();
    const next = vi.fn();

    idempotencyKey(req as never, res as never, next);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      errorCode: 'BAD_REQUEST',
      details: { field: 'Idempotency-Key', maxLength: 4 },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('stores normalized idempotency key', () => {
    const req = makeReq('  key-1  ');
    const res = makeRes();
    const next = vi.fn();

    idempotencyKey(req as never, res as never, next);

    expect(req.idempotencyKey).toBe('key-1');
    expect(next).toHaveBeenCalled();
  });
});
