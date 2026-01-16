vi.mock('../src/utils/redisClient.js', () => ({
  getRedisClient: vi.fn(),
  getRedisNamespace: vi.fn(),
}));

import { redisDel, redisGetString, redisSetStringEx, nsKey } from '../src/utils/redisCache.js';
import { getRedisClient, getRedisNamespace } from '../src/utils/redisClient.js';

describe('utils: redis cache', () => {
  const mockClient = {
    get: vi.fn(),
    setEx: vi.fn(),
    del: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.get.mockReset();
    mockClient.setEx.mockReset();
    mockClient.del.mockReset();
  });

  it('returns null when redis is unavailable', async () => {
    vi.mocked(getRedisClient).mockResolvedValue(null);
    const value = await redisGetString('missing');
    expect(value).toBeNull();
  });

  it('reads values and handles errors', async () => {
    vi.mocked(getRedisClient).mockResolvedValue(mockClient as unknown as Awaited<ReturnType<typeof getRedisClient>>);
    mockClient.get.mockResolvedValueOnce('value');
    await expect(redisGetString('key')).resolves.toBe('value');

    mockClient.get.mockRejectedValueOnce(new Error('fail'));
    await expect(redisGetString('key')).resolves.toBeNull();
  });

  it('sets values with ttl clamping', async () => {
    vi.mocked(getRedisClient).mockResolvedValue(mockClient as unknown as Awaited<ReturnType<typeof getRedisClient>>);
    await redisSetStringEx('key', 100000, 'value');
    expect(mockClient.setEx).toHaveBeenCalledWith('key', 86400, 'value');
  });

  it('deletes keys and ignores errors', async () => {
    vi.mocked(getRedisClient).mockResolvedValue(mockClient as unknown as Awaited<ReturnType<typeof getRedisClient>>);
    mockClient.del.mockResolvedValueOnce(1);
    await redisDel('key');
    expect(mockClient.del).toHaveBeenCalledWith('key');

    mockClient.del.mockRejectedValueOnce(new Error('fail'));
    await expect(redisDel('key')).resolves.toBeUndefined();
  });

  it('builds namespaced keys', () => {
    vi.mocked(getRedisNamespace).mockReturnValue('beta');
    expect(nsKey('cache', 'abc')).toBe('memalerts:beta:cache:abc');
  });
});
