import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const redisMocks = vi.hoisted(() => {
  const client = {
    connect: vi.fn(),
    on: vi.fn(),
    get: vi.fn(),
    setEx: vi.fn(),
    del: vi.fn(),
  };
  const createClient = vi.fn(() => client);
  return { client, createClient };
});

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('redis', () => ({ createClient: redisMocks.createClient }));
vi.mock('../src/utils/logger.js', () => ({ logger: loggerMock }));

const baseEnv = { ...process.env };

async function importRedisClient() {
  return await import('../src/utils/redisClient.js');
}

async function importRedisCache() {
  return await import('../src/utils/redisCache.js');
}

beforeEach(() => {
  process.env = { ...baseEnv };
  redisMocks.client.connect.mockReset();
  redisMocks.client.on.mockReset();
  redisMocks.client.get.mockReset();
  redisMocks.client.setEx.mockReset();
  redisMocks.client.del.mockReset();
  redisMocks.createClient.mockClear();
  loggerMock.info.mockReset();
  loggerMock.warn.mockReset();
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...baseEnv };
  vi.restoreAllMocks();
});

describe('utils: redis client', () => {
  it('returns null when redis is disabled', async () => {
    delete process.env.REDIS_URL;

    const { getRedisClient, isRedisEnabled } = await importRedisClient();
    const client = await getRedisClient();

    expect(isRedisEnabled()).toBe(false);
    expect(client).toBeNull();
    expect(redisMocks.createClient).not.toHaveBeenCalled();
  });

  it('connects once and caches the client', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    redisMocks.client.connect.mockResolvedValue(undefined);

    const { getRedisClient } = await importRedisClient();
    const first = await getRedisClient();
    const second = await getRedisClient();

    expect(first).toBe(redisMocks.client);
    expect(second).toBe(redisMocks.client);
    expect(redisMocks.createClient).toHaveBeenCalledTimes(1);
    expect(redisMocks.client.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(loggerMock.info).toHaveBeenCalledWith('redis.connected', {});
  });

  it('resets cache after connection failure', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    redisMocks.client.connect.mockRejectedValueOnce(new Error('connect failed')).mockResolvedValueOnce(undefined);

    const { getRedisClient } = await importRedisClient();
    const first = await getRedisClient();
    const second = await getRedisClient();

    expect(first).toBeNull();
    expect(second).toBe(redisMocks.client);
    expect(redisMocks.createClient).toHaveBeenCalledTimes(2);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'redis.connect_failed',
      expect.objectContaining({ errorMessage: 'connect failed' })
    );
  });
});

describe('utils: redis cache helpers', () => {
  it('gets a cached value and returns null on cache miss', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    redisMocks.client.connect.mockResolvedValue(undefined);
    redisMocks.client.get.mockResolvedValueOnce('value').mockResolvedValueOnce(null);

    const { redisGetString } = await importRedisCache();

    await expect(redisGetString('key')).resolves.toBe('value');
    await expect(redisGetString('missing')).resolves.toBeNull();
    expect(redisMocks.client.get).toHaveBeenCalledWith('key');
    expect(redisMocks.client.get).toHaveBeenCalledWith('missing');
  });

  it('clamps TTL and sets values with expiration', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    redisMocks.client.connect.mockResolvedValue(undefined);

    const { redisSetStringEx } = await importRedisCache();

    await redisSetStringEx('short', 0, 'a');
    await redisSetStringEx('long', 999999, 'b');

    expect(redisMocks.client.setEx).toHaveBeenCalledWith('short', 1, 'a');
    expect(redisMocks.client.setEx).toHaveBeenCalledWith('long', 24 * 60 * 60, 'b');
  });

  it('deletes cached keys', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    redisMocks.client.connect.mockResolvedValue(undefined);

    const { redisDel } = await importRedisCache();
    await redisDel('key');

    expect(redisMocks.client.del).toHaveBeenCalledWith('key');
  });

  it('builds namespaced keys for beta and prod', async () => {
    const { nsKey } = await importRedisCache();

    process.env.DOMAIN = 'beta.example.com';
    expect(nsKey('cache', 'one')).toBe('memalerts:beta:cache:one');

    process.env.DOMAIN = 'example.com';
    process.env.PORT = '3002';
    expect(nsKey('cache', 'two')).toBe('memalerts:beta:cache:two');

    process.env.DOMAIN = 'example.com';
    process.env.PORT = '3001';
    expect(nsKey('cache', 'three')).toBe('memalerts:prod:cache:three');
  });
});
