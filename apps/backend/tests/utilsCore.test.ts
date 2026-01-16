import jwt from 'jsonwebtoken';

import { prisma } from '../src/lib/prisma.js';
import { calculatePriceWithDiscount, getActivePromotion } from '../src/utils/promotions.js';
import { toPublicChannelDto, toPublicMemeDto } from '../src/utils/dto.js';
import { getOrCreateTags } from '../src/utils/tags.js';
import { signJwt, verifyJwtWithRotation } from '../src/utils/jwt.js';
import { getEntitledChannelIds, hasChannelEntitlement } from '../src/utils/entitlements.js';
import { extractHttpStatus, isTimeoutError, isTransientHttpError } from '../src/utils/httpErrors.js';
import {
  PaginationError,
  buildCursorFilter,
  encodeCursorFromItem,
  mergeCursorWhere,
  parseLimit,
  safeDecodeCursor,
} from '../src/utils/pagination.js';
import { createChannel, createChannelEntitlement, createMeme, createPromotion } from './factories/index.js';
import * as metrics from '../src/utils/metrics.js';

describe('utils: pagination', () => {
  it('parses limits and rejects invalid values', () => {
    expect(parseLimit(undefined)).toBe(50);
    expect(parseLimit('10')).toBe(10);
    expect(() => parseLimit('nope')).toThrow(PaginationError);
    expect(() => parseLimit(1000, { maxLimit: 100 })).toThrow(PaginationError);
  });

  it('encodes and decodes cursors with defaults', () => {
    const createdAt = new Date('2024-01-01T00:00:00.000Z');
    const cursor = encodeCursorFromItem({ createdAt, id: 'abc' });
    expect(typeof cursor).toBe('string');
    const decoded = safeDecodeCursor(cursor);
    expect(decoded?.id).toBe('abc');
    expect(decoded?.createdAt instanceof Date).toBe(true);
    expect((decoded?.createdAt as Date).toISOString()).toBe(createdAt.toISOString());
  });

  it('builds cursor filters and merges where clauses', () => {
    const cursor = { createdAt: new Date('2024-01-01T00:00:00.000Z'), id: 'abc' };
    const filter = buildCursorFilter(
      [
        { key: 'createdAt', direction: 'desc', type: 'date' },
        { key: 'id', direction: 'desc', type: 'string' },
      ],
      cursor
    );
    expect(filter).toMatchObject({
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { AND: [{ createdAt: { equals: cursor.createdAt } }, { id: { lt: cursor.id } }] },
      ],
    });
    const merged = mergeCursorWhere({ status: 'approved' }, filter as Record<string, unknown>);
    expect(merged).toMatchObject({ AND: [{ status: 'approved' }, filter] });
  });
});

describe('utils: dto', () => {
  it('maps public channel and meme DTOs', async () => {
    const channel = await createChannel({
      name: 'Test Channel',
      slug: 'test-channel',
      coinPerPointRatio: 12,
      submissionRewardCoins: 50,
      overlayMode: 'queue',
      overlayShowSender: true,
      overlayMaxConcurrent: 2,
      coinIconUrl: null,
      primaryColor: null,
      secondaryColor: null,
      accentColor: null,
    });
    const stats = { memesCount: 3, usersCount: 9 };
    const dto = toPublicChannelDto(channel, stats);
    expect(dto).toMatchObject({
      slug: 'test-channel',
      name: 'Test Channel',
      coinPerPointRatio: 12,
      submissionRewardCoins: 50,
      overlayMode: 'queue',
      overlayShowSender: true,
      overlayMaxConcurrent: 2,
      stats,
    });
    expect('id' in dto).toBe(false);

    const meme = await createMeme({ title: 'Test Meme', fileUrl: '/uploads/test.webm' });
    const memeDto = toPublicMemeDto({ ...meme, createdBy: { displayName: 'Viewer' } });
    expect(memeDto).toMatchObject({
      id: meme.id,
      title: 'Test Meme',
      fileUrl: '/uploads/test.webm',
      createdBy: { displayName: 'Viewer' },
    });
  });
});

describe('utils: tags', () => {
  it('normalizes tags and reuses existing ones', async () => {
    const ids = await getOrCreateTags([' Foo ', 'foo', 'bar', '']);
    expect(ids).toHaveLength(2);
    const tags = await prisma.tag.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const names = tags.map((t) => t.name).sort();
    expect(names).toEqual(['bar', 'foo']);

    const fooId = tags.find((t) => t.name === 'foo')?.id;
    const second = await getOrCreateTags(['foo']);
    expect(second).toHaveLength(1);
    expect(fooId ? second.includes(fooId) : false).toBe(true);
  });
});

describe('utils: jwt', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('signs tokens with a kid header', () => {
    process.env.JWT_SECRET = 'current-secret';
    const token = signJwt({ sub: 'user-1' }, { expiresIn: '5m' });
    const decoded = jwt.decode(token, { complete: true });
    expect(decoded && typeof decoded === 'object').toBe(true);
    const header = (decoded as { header: jwt.JwtHeader }).header;
    expect(typeof header.kid).toBe('string');
    expect(String(header.kid).length).toBeGreaterThan(0);
  });

  it('verifies tokens with previous secret and records metric', () => {
    process.env.JWT_SECRET = 'current-secret';
    process.env.JWT_SECRET_PREVIOUS = 'previous-secret';
    const payload = { sub: 'user-2', role: 'viewer' };
    const legacyToken = jwt.sign(payload, 'previous-secret', { expiresIn: '5m' });
    const spy = vi.spyOn(metrics, 'recordJwtPreviousKeyVerification');
    const verified = verifyJwtWithRotation<typeof payload>(legacyToken, 'test');
    expect(verified.sub).toBe('user-2');
    expect(spy).toHaveBeenCalledWith('test');
  });
});

describe('utils: entitlements', () => {
  it('returns false when channel id is missing', async () => {
    const result = await hasChannelEntitlement('', 'custom_bot');
    expect(result).toBe(false);
  });

  it('returns active entitlements and filters expired ones', async () => {
    const activeChannel = await createChannel();
    const expiredChannel = await createChannel();
    await createChannelEntitlement({
      channelId: activeChannel.id,
      key: 'custom_bot',
      enabled: true,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await createChannelEntitlement({
      channelId: expiredChannel.id,
      key: 'custom_bot',
      enabled: true,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const active = await hasChannelEntitlement(activeChannel.id, 'custom_bot');
    const expired = await hasChannelEntitlement(expiredChannel.id, 'custom_bot');
    expect(active).toBe(true);
    expect(expired).toBe(false);

    const entitled = await getEntitledChannelIds([activeChannel.id, expiredChannel.id], 'custom_bot');
    expect(entitled.has(activeChannel.id)).toBe(true);
    expect(entitled.has(expiredChannel.id)).toBe(false);
  });
});

describe('utils: promotions', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns the highest active discount', async () => {
    process.env.PROMO_CACHE_MS = '1';
    const channel = await createChannel();
    await createPromotion({ channelId: channel.id, discountPercent: 10 });
    await createPromotion({ channelId: channel.id, discountPercent: 25 });
    const promo = await getActivePromotion(channel.id);
    expect(promo?.discountPercent).toBe(25);
  });

  it('handles missing promotions and calculates discounts', async () => {
    const channel = await createChannel();
    const promo = await getActivePromotion(channel.id);
    expect(promo).toBeNull();
    expect(calculatePriceWithDiscount(100, 50)).toBe(50);
    expect(calculatePriceWithDiscount(100, 33)).toBe(67);
  });
});

describe('utils: httpErrors', () => {
  it('extracts http status and detects timeouts', () => {
    expect(extractHttpStatus({ status: 404 })).toBe(404);
    expect(extractHttpStatus({ statusCode: 401 })).toBe(401);
    expect(extractHttpStatus({ response: { status: 503 } })).toBe(503);
    expect(extractHttpStatus({})).toBeNull();

    expect(isTimeoutError({ name: 'AbortError' })).toBe(true);
    expect(isTimeoutError({ message: 'Request timed out' })).toBe(true);
    expect(isTimeoutError({ code: 'ETIMEDOUT' })).toBe(true);
  });

  it('detects transient http errors', () => {
    expect(isTransientHttpError({ status: 500 })).toBe(true);
    expect(isTransientHttpError({ status: 429 })).toBe(true);
    expect(isTransientHttpError({ status: 400 })).toBe(false);
    expect(isTransientHttpError({ message: 'timeout' })).toBe(true);
  });
});
