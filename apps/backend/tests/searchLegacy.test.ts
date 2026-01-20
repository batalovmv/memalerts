import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  meme: {
    findMany: vi.fn(),
  },
  memeActivation: {
    groupBy: vi.fn(),
  },
  $queryRaw: vi.fn(),
}));

const cacheMocks = vi.hoisted(() => ({
  parseTagNames: vi.fn(),
  resolveTagIds: vi.fn(),
}));

const searchSharedMocks = vi.hoisted(() => ({
  sendSearchResponse: vi.fn((req: unknown, res: { json: (body: unknown) => unknown }, payload: unknown) =>
    res.json(payload)
  ),
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../src/controllers/viewer/cache.js', () => cacheMocks);
vi.mock('../src/controllers/viewer/search/searchShared.js', () => searchSharedMocks);

import { handleLegacySearch } from '../src/controllers/viewer/search/searchLegacy.js';

function makeRes() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    req: { userId: 'user-1', headers: {} },
    res: makeRes(),
    targetChannelId: 'channel-1',
    targetChannel: null,
    memeCatalogMode: 'channel',
    minPrice: null,
    maxPrice: null,
    qStr: '',
    tagsStr: '',
    includeUploaderEnabled: false,
    favoritesEnabled: false,
    sortByStr: 'createdAt',
    sortOrderStr: 'desc',
    parsedLimit: 10,
    parsedOffset: 0,
    ...overrides,
  };
}

beforeEach(() => {
  prismaMock.meme.findMany.mockReset();
  prismaMock.memeActivation.groupBy.mockReset();
  prismaMock.$queryRaw.mockReset();
  cacheMocks.parseTagNames.mockReset();
  cacheMocks.resolveTagIds.mockReset();
  searchSharedMocks.sendSearchResponse.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleLegacySearch', () => {
  it('returns empty when tag ids are missing', async () => {
    cacheMocks.parseTagNames.mockReturnValue(['missing']);
    cacheMocks.resolveTagIds.mockResolvedValue([]);

    const ctx = makeCtx({ tagsStr: 'missing' });

    await handleLegacySearch(ctx as never, {});

    expect((ctx.res as ReturnType<typeof makeRes>).body).toEqual([]);
    expect(prismaMock.meme.findMany).not.toHaveBeenCalled();
  });

  it('returns favorites ordered by activation count', async () => {
    prismaMock.memeActivation.groupBy.mockResolvedValue([{ memeId: 'm2' }, { memeId: 'm1' }]);
    prismaMock.meme.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);

    const ctx = makeCtx({ favoritesEnabled: true });
    const rawQuery = {};

    await handleLegacySearch(ctx as never, rawQuery);

    const body = (ctx.res as ReturnType<typeof makeRes>).body as Array<{ id: string }>;
    expect(body.map((row) => row.id)).toEqual(['m2', 'm1']);
    expect(prismaMock.memeActivation.groupBy).toHaveBeenCalled();
  });

  it('uses popularity query and sends enriched response', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { id: 'm1', pop: 3 },
      { id: 'm2', pop: 1 },
    ]);
    prismaMock.meme.findMany.mockResolvedValue([
      { id: 'm1', status: 'approved', createdAt: new Date() },
      { id: 'm2', status: 'approved', createdAt: new Date() },
    ]);

    const ctx = makeCtx({ includeUploaderEnabled: true });
    const rawQuery = { sortBy: 'popularity', sortOrder: 'desc', q: 'test' };

    await handleLegacySearch(ctx as never, rawQuery);

    expect(searchSharedMocks.sendSearchResponse).toHaveBeenCalled();
    const payload = searchSharedMocks.sendSearchResponse.mock.calls[0][2] as Array<{
      id: string;
      _count: { activations: number };
    }>;
    expect(payload[0]).toMatchObject({ id: 'm1', _count: { activations: 3 } });
  });

  it('falls back to default sort when stats table is missing', async () => {
    prismaMock.$queryRaw.mockRejectedValue({ code: 'P2021' });
    prismaMock.meme.findMany.mockResolvedValue([]);

    const ctx = makeCtx({ targetChannelId: null });
    const rawQuery = { sortBy: 'popularity' };

    await handleLegacySearch(ctx as never, rawQuery);

    expect(prismaMock.meme.findMany).toHaveBeenCalled();
    expect((ctx.res as ReturnType<typeof makeRes>).body).toEqual([]);
  });
});
