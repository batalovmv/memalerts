import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  auditLog: {
    create: vi.fn(),
  },
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../src/utils/logger.js', () => ({ logger: loggerMock }));

const baseEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...baseEnv };
  prismaMock.auditLog.create.mockReset();
  loggerMock.info.mockReset();
  loggerMock.error.mockReset();
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...baseEnv };
  vi.restoreAllMocks();
});

describe('utils: audit logger', () => {
  it('extracts request metadata', async () => {
    const { getRequestMetadata } = await import('../src/utils/auditLogger.js');
    const req = {
      headers: { 'cf-connecting-ip': '1.2.3.4', 'user-agent': 'ua' },
      socket: { remoteAddress: '5.6.7.8' },
      ip: '9.9.9.9',
    };

    const meta = getRequestMetadata(req as never);
    expect(meta.ipAddress).toBe('1.2.3.4');
    expect(meta.userAgent).toBe('ua');
  });

  it('writes audit logs to database when channelId is present', async () => {
    process.env.LOG_SILENT_TESTS = '1';
    const { auditLog } = await import('../src/utils/auditLogger.js');

    await auditLog({
      action: 'test.action',
      actorId: 'user-1',
      channelId: 'channel-1',
      payload: { foo: 'bar' },
    });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'user-1',
          channelId: 'channel-1',
          action: 'test.action',
        }),
      })
    );
  });

  it('logs auth events through auditLog', async () => {
    process.env.LOG_SILENT_TESTS = '0';
    const mod = await import('../src/utils/auditLogger.js');
    const req = { headers: { 'user-agent': 'ua' }, socket: {}, ip: '1.1.1.1' };

    await mod.logAuthEvent('login', 'user-1', true, req as never);

    expect(loggerMock.info).toHaveBeenCalledWith(
      'audit.log',
      expect.objectContaining({
        entry: expect.objectContaining({
          action: 'auth.login',
          actorId: 'user-1',
          success: true,
        }),
      })
    );
  });

  it('logs db failures when audit logging fails', async () => {
    process.env.LOG_SILENT_TESTS = '0';
    prismaMock.auditLog.create.mockRejectedValueOnce(new Error('db down'));
    const { auditLog } = await import('../src/utils/auditLogger.js');

    await auditLog({
      action: 'test.action',
      actorId: 'user-1',
      channelId: 'channel-1',
      payload: { foo: 'bar' },
    });

    expect(loggerMock.error).toHaveBeenCalledWith(
      'audit.db_write_failed',
      expect.objectContaining({ action: 'test.action', channelId: 'channel-1' })
    );
  });
});
