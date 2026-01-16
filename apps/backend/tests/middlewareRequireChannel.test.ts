import { describe, expect, it } from 'vitest';

import { requireChannel } from '../src/middleware/requireChannel.js';

type TestRes = {
  statusCode: number;
  body?: unknown;
  status: (code: number) => TestRes;
  json: (body: unknown) => TestRes;
};

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

describe('middleware: requireChannel', () => {
  it('rejects users without channel', () => {
    const req = { channelId: null };
    const res = makeRes();
    const next = () => {};

    requireChannel(req as never, res as never, next as never);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ errorCode: 'BAD_REQUEST', details: { field: 'channelId' } });
  });

  it('allows users with channel', () => {
    const req = { channelId: 'channel-1' };
    const res = makeRes();
    let called = false;
    const next = () => {
      called = true;
    };

    requireChannel(req as never, res as never, next as never);

    expect(called).toBe(true);
    expect(res.statusCode).toBe(200);
  });
});
