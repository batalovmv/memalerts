import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  memeAsset: {
    count: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
}));

const auditMocks = vi.hoisted(() => ({
  auditLog: vi.fn(),
  getRequestMetadata: vi.fn(() => ({ ipAddress: '127.0.0.1', userAgent: 'test-agent' })),
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../src/utils/auditLogger.js', () => auditMocks);

import { moderationMemeAssetController } from '../src/controllers/moderation/memeAssetModerationController.js';

type TestRes = {
  statusCode: number;
  body?: unknown;
  headers: Record<string, string>;
  status: (code: number) => TestRes;
  json: (body: unknown) => TestRes;
  setHeader: (key: string, value: string) => void;
};

type TestReq = {
  requestId?: string;
  userId?: string;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
};

function makeRes(): TestRes {
  const res: TestRes = {
    statusCode: 200,
    headers: {},
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    setHeader(key: string, value: string) {
      res.headers[key.toLowerCase()] = String(value);
    },
  };
  return res;
}

function makeReq(overrides: Partial<TestReq> = {}): TestReq {
  return {
    requestId: 'req-1',
    userId: 'user-1',
    params: {},
    query: {},
    body: {},
    ...overrides,
  };
}

beforeEach(() => {
  prismaMock.memeAsset.count.mockReset();
  prismaMock.memeAsset.findMany.mockReset();
  prismaMock.memeAsset.update.mockReset();
  auditMocks.auditLog.mockReset();
  auditMocks.getRequestMetadata.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('moderationMemeAssetController.list', () => {
  it('rejects invalid status filter', async () => {
    const req = makeReq({ query: { status: 'nope' } });
    const res = makeRes();

    await moderationMemeAssetController.list(req as never, res as never);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ errorCode: 'BAD_REQUEST' });
    expect(prismaMock.memeAsset.count).not.toHaveBeenCalled();
  });

  it('returns rows with pagination headers', async () => {
    prismaMock.memeAsset.count.mockResolvedValue(1);
    prismaMock.memeAsset.findMany.mockResolvedValue([
      {
        id: 'asset-1',
        type: 'image',
        fileUrl: 'https://example.com/a.png',
        fileHash: 'hash-1',
        durationMs: null,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        poolVisibility: 'hidden',
        poolHiddenAt: new Date('2024-01-02T00:00:00Z'),
        poolHiddenByUserId: 'user-1',
        poolHiddenReason: 'bad',
        purgeRequestedAt: null,
        purgeNotBefore: null,
        purgedAt: null,
        purgeReason: null,
        purgeByUserId: null,
        hiddenBy: { id: 'user-1', displayName: 'Admin' },
        purgedBy: null,
      },
    ]);

    const req = makeReq({ query: { status: 'hidden', limit: '20', offset: '5', q: 'bad' } });
    const res = makeRes();

    await moderationMemeAssetController.list(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-total']).toBe('1');
    expect(res.headers['x-limit']).toBe('20');
    expect(res.headers['x-offset']).toBe('5');
    expect(Array.isArray(res.body)).toBe(true);
    expect((res.body as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: 'asset-1',
      hiddenReason: 'bad',
      hiddenByUserId: 'user-1',
    });
  });
});

describe('moderationMemeAssetController.hide', () => {
  it('hides meme asset and writes audit log', async () => {
    prismaMock.memeAsset.update.mockResolvedValue({
      id: 'asset-1',
      poolVisibility: 'hidden',
      poolHiddenAt: new Date('2024-01-01T00:00:00Z'),
      poolHiddenByUserId: 'user-1',
      poolHiddenReason: 'bad',
      hiddenBy: { id: 'user-1', displayName: 'Admin' },
    });
    auditMocks.auditLog.mockResolvedValue(undefined);

    const req = makeReq({ params: { id: 'asset-1' }, body: { reason: 'bad' }, userId: 'user-1' });
    const res = makeRes();

    await moderationMemeAssetController.hide(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      id: 'asset-1',
      poolHiddenReason: 'bad',
      hiddenReason: 'bad',
    });
    expect(auditMocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'moderation.memeAsset.hide',
        success: true,
        actorId: 'user-1',
      })
    );
  });

  it('returns 404 when hide fails', async () => {
    prismaMock.memeAsset.update.mockRejectedValue(new Error('missing'));

    const req = makeReq({ params: { id: 'missing' }, body: { reason: 'bad' }, userId: 'user-1' });
    const res = makeRes();

    await moderationMemeAssetController.hide(req as never, res as never);

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ errorCode: 'NOT_FOUND' });
    expect(auditMocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'moderation.memeAsset.hide',
        success: false,
      })
    );
  });
});

describe('moderationMemeAssetController.unhide', () => {
  it('unhides meme asset and writes audit log', async () => {
    prismaMock.memeAsset.update.mockResolvedValue({
      id: 'asset-1',
      poolVisibility: 'visible',
      poolHiddenAt: null,
      poolHiddenByUserId: null,
      poolHiddenReason: null,
      purgeRequestedAt: null,
      purgeNotBefore: null,
      purgedAt: null,
      hiddenBy: null,
      purgedBy: null,
    });
    auditMocks.auditLog.mockResolvedValue(undefined);

    const req = makeReq({ params: { id: 'asset-1' }, userId: 'user-1' });
    const res = makeRes();

    await moderationMemeAssetController.unhide(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ poolVisibility: 'visible' });
    expect(auditMocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'moderation.memeAsset.unhide',
        success: true,
      })
    );
  });

  it('returns 404 when unhide fails', async () => {
    prismaMock.memeAsset.update.mockRejectedValue(new Error('missing'));

    const req = makeReq({ params: { id: 'missing' }, userId: 'user-1' });
    const res = makeRes();

    await moderationMemeAssetController.unhide(req as never, res as never);

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ errorCode: 'NOT_FOUND' });
    expect(auditMocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'moderation.memeAsset.unhide',
        success: false,
      })
    );
  });
});

describe('moderationMemeAssetController.del', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, MEME_ASSET_QUARANTINE_DAYS: '10' };
  });

  it('requires a reason', async () => {
    const req = makeReq({ params: { id: 'asset-1' }, body: {}, userId: 'user-1' });
    const res = makeRes();

    await moderationMemeAssetController.del(req as never, res as never);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ errorCode: 'VALIDATION_ERROR' });
  });

  it('quarantines meme asset with defaulted days', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-01T00:00:00Z'));

    prismaMock.memeAsset.update.mockResolvedValue({
      id: 'asset-1',
      poolVisibility: 'hidden',
      poolHiddenAt: new Date('2024-02-01T00:00:00Z'),
      poolHiddenByUserId: 'user-1',
      poolHiddenReason: 'dmca',
      purgeRequestedAt: new Date('2024-02-01T00:00:00Z'),
      purgeNotBefore: new Date('2024-02-04T00:00:00Z'),
      purgedAt: null,
      purgeReason: 'dmca',
      purgeByUserId: 'user-1',
      hiddenBy: { id: 'user-1', displayName: 'Admin' },
      purgedBy: { id: 'user-1', displayName: 'Admin' },
    });

    const req = makeReq({
      params: { id: 'asset-1' },
      body: { reason: 'dmca', days: 2 },
      userId: 'user-1',
    });
    const res = makeRes();

    await moderationMemeAssetController.del(req as never, res as never);

    expect(res.statusCode).toBe(200);
    const updateArg = prismaMock.memeAsset.update.mock.calls[0]?.[0];
    expect(updateArg?.data?.poolVisibility).toBe('hidden');
    expect(updateArg?.data?.purgeNotBefore).toBeInstanceOf(Date);
    expect(res.body).toMatchObject({ purgeReason: 'dmca' });
    expect(auditMocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'moderation.memeAsset.delete',
        success: true,
      })
    );
  });
});
