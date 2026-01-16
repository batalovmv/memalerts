import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  globalModerator: {
    findUnique: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));

import { requireGlobalModerator } from '../src/middleware/moderator.js';

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

beforeEach(() => {
  prismaMock.globalModerator.findUnique.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('middleware: requireGlobalModerator', () => {
  it('rejects unauthenticated requests', async () => {
    const req = { requestId: 'req-1' };
    const res = makeRes();
    const next = vi.fn();

    await requireGlobalModerator()(req as never, res as never, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ errorCode: 'UNAUTHORIZED' });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows admin without db lookup', async () => {
    const req = { userId: 'user-1', userRole: 'admin' };
    const res = makeRes();
    const next = vi.fn();

    await requireGlobalModerator()(req as never, res as never, next);

    expect(next).toHaveBeenCalled();
    expect(prismaMock.globalModerator.findUnique).not.toHaveBeenCalled();
  });

  it('allows active global moderator', async () => {
    prismaMock.globalModerator.findUnique.mockResolvedValue({ revokedAt: null });
    const req = { userId: 'user-1', userRole: 'viewer' };
    const res = makeRes();
    const next = vi.fn();

    await requireGlobalModerator()(req as never, res as never, next);

    expect(next).toHaveBeenCalled();
  });

  it('rejects revoked or missing moderator', async () => {
    prismaMock.globalModerator.findUnique.mockResolvedValue({ revokedAt: new Date() });
    const req = { userId: 'user-1', userRole: 'viewer' };
    const res = makeRes();

    await requireGlobalModerator()(req as never, res as never, vi.fn());

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ errorCode: 'FORBIDDEN' });
  });

  it('returns 500 on db errors', async () => {
    prismaMock.globalModerator.findUnique.mockRejectedValue(new Error('db down'));
    const req = { userId: 'user-1', userRole: 'viewer' };
    const res = makeRes();

    await requireGlobalModerator()(req as never, res as never, vi.fn());

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ errorCode: 'INTERNAL_ERROR' });
  });
});
