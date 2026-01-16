import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const redisMocks = vi.hoisted(() => {
  const pubClient = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    duplicate: vi.fn(),
  };
  const subClient = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    duplicate: vi.fn(),
  };
  pubClient.duplicate.mockReturnValue(subClient);
  const createClient = vi.fn(() => pubClient);
  return { pubClient, subClient, createClient };
});

const adapterMocks = vi.hoisted(() => ({
  createAdapter: vi.fn(() => 'adapter'),
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

const redisClientMocks = vi.hoisted(() => ({
  isRedisEnabled: vi.fn(),
}));

vi.mock('redis', () => ({ createClient: redisMocks.createClient }));
vi.mock('@socket.io/redis-adapter', () => ({ createAdapter: adapterMocks.createAdapter }));
vi.mock('../src/utils/logger.js', () => ({ logger: loggerMock }));
vi.mock('../src/utils/redisClient.js', () => ({ isRedisEnabled: redisClientMocks.isRedisEnabled }));

const baseEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...baseEnv, REDIS_URL: 'redis://localhost:6379' };
  redisClientMocks.isRedisEnabled.mockReset();
  redisMocks.pubClient.duplicate.mockReset().mockReturnValue(redisMocks.subClient);
  redisMocks.pubClient.connect.mockReset();
  redisMocks.pubClient.disconnect.mockReset();
  redisMocks.subClient.connect.mockReset();
  redisMocks.subClient.disconnect.mockReset();
  redisMocks.createClient.mockReset().mockImplementation(() => redisMocks.pubClient);
  adapterMocks.createAdapter.mockReset().mockReturnValue('adapter');
  loggerMock.info.mockReset();
  loggerMock.warn.mockReset();
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...baseEnv };
  vi.restoreAllMocks();
});

describe('socket: redis adapter', () => {
  it('skips setup when redis is disabled', async () => {
    redisClientMocks.isRedisEnabled.mockReturnValue(false);
    const io = { adapter: vi.fn() };

    const { maybeSetupSocketIoRedisAdapter } = await import('../src/socket/redisAdapter.js');
    await maybeSetupSocketIoRedisAdapter(io as never);

    expect(redisMocks.createClient).not.toHaveBeenCalled();
    expect(io.adapter).not.toHaveBeenCalled();
  });

  it('connects and configures adapter when redis is enabled', async () => {
    redisClientMocks.isRedisEnabled.mockReturnValue(true);
    redisMocks.pubClient.connect.mockResolvedValue(undefined);
    redisMocks.subClient.connect.mockResolvedValue(undefined);
    const io = { adapter: vi.fn() };

    const { maybeSetupSocketIoRedisAdapter } = await import('../src/socket/redisAdapter.js');
    await maybeSetupSocketIoRedisAdapter(io as never);

    expect(redisMocks.createClient).toHaveBeenCalled();
    expect(adapterMocks.createAdapter).toHaveBeenCalledWith(redisMocks.pubClient, redisMocks.subClient);
    expect(io.adapter).toHaveBeenCalledWith('adapter');
    expect(loggerMock.info).toHaveBeenCalledWith('socket.redis_adapter.enabled', {});
  });

  it('logs failures and disconnects clients', async () => {
    redisClientMocks.isRedisEnabled.mockReturnValue(true);
    redisMocks.pubClient.connect.mockRejectedValue(new Error('connect failed'));
    redisMocks.subClient.connect.mockResolvedValue(undefined);
    const io = { adapter: vi.fn() };

    const { maybeSetupSocketIoRedisAdapter } = await import('../src/socket/redisAdapter.js');
    await maybeSetupSocketIoRedisAdapter(io as never);

    expect(loggerMock.warn).toHaveBeenCalledWith(
      'socket.redis_adapter.failed',
      expect.objectContaining({ errorMessage: 'connect failed' })
    );
    expect(redisMocks.pubClient.disconnect).toHaveBeenCalled();
    expect(redisMocks.subClient.disconnect).toHaveBeenCalled();
  });
});
