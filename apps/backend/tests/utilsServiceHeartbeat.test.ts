import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  serviceHeartbeat: {
    upsert: vi.fn(),
  },
}));

const loggerMock = vi.hoisted(() => ({
  warn: vi.fn(),
}));

const fsMocks = vi.hoisted(() => ({
  readFileSync: vi.fn(() => JSON.stringify({ version: '1.2.3' })),
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../src/utils/logger.js', () => ({ logger: loggerMock }));
vi.mock('fs', () => ({
  default: fsMocks,
  readFileSync: fsMocks.readFileSync,
}));

const baseEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...baseEnv };
  prismaMock.serviceHeartbeat.upsert.mockReset();
  loggerMock.warn.mockReset();
  fsMocks.readFileSync.mockReset().mockReturnValue(JSON.stringify({ version: '1.2.3' }));
  vi.useFakeTimers();
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...baseEnv };
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('utils: service heartbeat', () => {
  it('records heartbeat and stops on demand', async () => {
    prismaMock.serviceHeartbeat.upsert.mockResolvedValue({});
    const { startServiceHeartbeat } = await import('../src/utils/serviceHeartbeat.js');

    const handle = startServiceHeartbeat({ service: 'api', intervalMs: 5000, meta: { region: 'eu' } });
    await Promise.resolve();

    expect(prismaMock.serviceHeartbeat.upsert).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(prismaMock.serviceHeartbeat.upsert).toHaveBeenCalledTimes(2);

    handle.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(prismaMock.serviceHeartbeat.upsert).toHaveBeenCalledTimes(2);
  });

  it('halts updates when heartbeat table is missing', async () => {
    prismaMock.serviceHeartbeat.upsert.mockRejectedValueOnce({ code: 'P2021' });
    const { startServiceHeartbeat } = await import('../src/utils/serviceHeartbeat.js');

    startServiceHeartbeat({ service: 'api', intervalMs: 5000 });
    await Promise.resolve();

    expect(loggerMock.warn).toHaveBeenCalledWith('heartbeat.table_missing', expect.any(Object));

    await vi.advanceTimersByTimeAsync(5000);
    expect(prismaMock.serviceHeartbeat.upsert).toHaveBeenCalledTimes(1);
  });
});
