import jwt from 'jsonwebtoken';

import { prisma } from '../src/lib/prisma.js';
import { toPublicChannelDto, toPublicMemeDto } from '../src/utils/dto.js';
import { hasChannelEntitlement, getEntitledChannelIds } from '../src/utils/entitlements.js';
import { extractHttpStatus, isTimeoutError, isTransientHttpError } from '../src/utils/httpErrors.js';
import { signJwt, verifyJwtWithRotation } from '../src/utils/jwt.js';
import {
  DEFAULT_CURSOR_SCHEMA,
  PaginationError,
  buildCursorFilter,
  encodeCursorFromItem,
  mergeCursorWhere,
  parseLimit,
  safeDecodeCursor,
} from '../src/utils/pagination.js';
import { calculatePriceWithDiscount, getActivePromotion } from '../src/utils/promotions.js';
import { getOrCreateTags } from '../src/utils/tags.js';
import {
  createChannel,
  createChannelEntitlement,
  createMeme,
  createPromotion,
  createUser,
} from './factories/index.js';

describe('utils: core', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.JWT_SECRET = 'test-secret';
    process.env.JWT_SECRET_PREVIOUS = 'prev-secret';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('parses limits and encodes/decodes cursors', () => {
    expect(parseLimit(undefined)).toBe(50);
    expect(parseLimit('5', { maxLimit: 10 })).toBe(5);
    expect(() => parseLimit('-1')).toThrow(PaginationError);

    const item = { createdAt: new Date('2024-01-01T00:00:00.000Z'), id: 'abc' };
    const cursor = encodeCursorFromItem(item, DEFAULT_CURSOR_SCHEMA);
    expect(typeof cursor).toBe('string');

    const decoded = safeDecodeCursor(cursor, DEFAULT_CURSOR_SCHEMA)!;
    expect(decoded.createdAt instanceof Date).toBe(true);
    expect(decoded.id).toBe('abc');

    const filter = buildCursorFilter(DEFAULT_CURSOR_SCHEMA, decoded);
    const merged = mergeCursorWhere({ status: 'active' }, filter);
    expect(merged).toHaveProperty('AND');
  });

  it('maps DTOs for channels and memes', async () => {
    const channel = await createChannel({ slug: 'dto-channel', name: 'DTO Channel' });
    const stats = { memesCount: 1, usersCount: 2 };
    const dto = toPublicChannelDto(channel, stats);
    expect(dto.slug).toBe(channel.slug);
    expect(dto.stats).toEqual(stats);

    const user = await createUser({ displayName: 'DTO User' });
    const meme = await createMeme({ channelId: channel.id, title: 'DTO Meme', createdByUserId: user.id });
    const memeDto = toPublicMemeDto({ ...meme, createdBy: { displayName: user.displayName } });
    expect(memeDto.createdBy?.displayName).toBe('DTO User');
  });

  it('creates and normalizes tags', async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const ids = await getOrCreateTags([`TagA-${suffix}`, `taga-${suffix}`, `TagB-${suffix}`]);
    expect(ids).toHaveLength(2);

    const names = [`taga-${suffix}`, `tagb-${suffix}`];
    const tags = await prisma.tag.findMany({ where: { name: { in: names } } });
    expect(tags).toHaveLength(2);
  });

  it('handles entitlements checks and bulk resolution', async () => {
    expect(await hasChannelEntitlement('', 'custom_bot')).toBe(false);

    const channel = await createChannel({ slug: 'entitled', name: 'Entitled' });
    await createChannelEntitlement({ channelId: channel.id, key: 'custom_bot', enabled: true });
    expect(await hasChannelEntitlement(channel.id, 'custom_bot')).toBe(true);

    const expired = await createChannel({ slug: 'expired', name: 'Expired' });
    await createChannelEntitlement({
      channelId: expired.id,
      key: 'custom_bot',
      enabled: true,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await hasChannelEntitlement(expired.id, 'custom_bot')).toBe(false);

    const active = await createChannel({ slug: 'active', name: 'Active' });
    const inactive = await createChannel({ slug: 'inactive', name: 'Inactive' });
    await createChannelEntitlement({ channelId: active.id, key: 'custom_bot', enabled: true });
    await createChannelEntitlement({ channelId: inactive.id, key: 'custom_bot', enabled: false });

    const set = await getEntitledChannelIds([active.id, inactive.id], 'custom_bot');
    expect(set.has(active.id)).toBe(true);
    expect(set.has(inactive.id)).toBe(false);
  });

  it('calculates promotions and prices', async () => {
    const channel = await createChannel({ slug: 'promo', name: 'Promo' });
    await createPromotion({ channelId: channel.id, discountPercent: 10 });
    await createPromotion({ channelId: channel.id, discountPercent: 30 });

    const promo = await getActivePromotion(channel.id);
    expect(promo?.discountPercent).toBe(30);
    expect(calculatePriceWithDiscount(100, 30)).toBe(70);
    expect(calculatePriceWithDiscount(10, 200)).toBe(0);
  });

  it('signs and verifies JWTs with rotation', () => {
    const token = signJwt({ userId: 'u1' });
    const payload = verifyJwtWithRotation<{ userId: string }>(token, 'test');
    expect(payload.userId).toBe('u1');

    const previousToken = jwt.sign({ userId: 'u2' }, process.env.JWT_SECRET_PREVIOUS!);
    const previousPayload = verifyJwtWithRotation<{ userId: string }>(previousToken, 'test');
    expect(previousPayload.userId).toBe('u2');
  });

  it('extracts HTTP error status and transient signals', () => {
    expect(extractHttpStatus({ status: 503 })).toBe(503);
    expect(extractHttpStatus({ response: { status: 404 } })).toBe(404);
    expect(extractHttpStatus('oops')).toBeNull();

    expect(isTimeoutError({ name: 'AbortError' })).toBe(true);
    expect(isTimeoutError({ message: 'Request timed out' })).toBe(true);
    expect(isTimeoutError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isTimeoutError({ message: 'oops' })).toBe(false);

    expect(isTransientHttpError({ status: 500 })).toBe(true);
    expect(isTransientHttpError({ status: 400 })).toBe(false);
  });
});
