import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Response } from 'express';
import type { Server as HttpServer } from 'http';
import type { Server as SocketIOServer } from 'socket.io';
import type { AuthRequest } from '../src/middleware/auth.js';
import { createSubmissionWithRepos } from '../src/services/SubmissionService.js';
import { fetchWithTimeout } from '../src/utils/httpTimeouts.js';
import { registerHealthRoutes } from '../src/routes/setup/healthRoutes.js';
import { setupShutdownHandlers } from '../src/server/shutdown.js';

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
}));

const redisClientMock = vi.hoisted(() => ({
  getRedisClient: vi.fn(),
  getRedisNamespace: vi.fn(() => 'test'),
}));

const metricsMock = vi.hoisted(() => ({
  recordHttpClientTimeout: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../src/utils/redisClient.js', () => redisClientMock);
vi.mock('../src/utils/metrics.js', () => ({ recordHttpClientTimeout: metricsMock.recordHttpClientTimeout }));

type TestResponse = {
  statusCode: number;
  body: unknown;
  headersSent: boolean;
  status: (code: number) => TestResponse;
  json: (payload: unknown) => TestResponse;
};

function createRes(): TestResponse {
  return {
    statusCode: 200,
    body: null,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
  };
}

const baseEnv = { ...process.env };
const originalFetch = global.fetch;

beforeEach(() => {
  process.env = { ...baseEnv };
  prismaMock.$queryRaw.mockReset();
  redisClientMock.getRedisClient.mockReset();
  redisClientMock.getRedisNamespace.mockReturnValue('test');
  metricsMock.recordHttpClientTimeout.mockReset();
});

afterEach(() => {
  process.env = { ...baseEnv };
  global.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('error scenarios', () => {
  it('returns degraded readyz when database check fails', async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error('db down'));
    const app = express();
    registerHealthRoutes(app);

    const res = await request(app).get('/readyz');

    expect(res.status).toBe(503);
    expect(res.body?.status).toBe('degraded');
    expect(res.body?.checks?.database).toBe('error');
  });

  it('records timeouts when external fetch exceeds the deadline', async () => {
    global.fetch = vi.fn(async () => {
      const error = new Error('request timeout');
      (error as { name?: string }).name = 'AbortError';
      throw error;
    }) as typeof fetch;

    const promise = fetchWithTimeout({
      url: 'https://example.com',
      init: {},
      service: 'test-service',
      timeoutMs: 10,
    });

    await expect(promise).rejects.toThrow(/timeout|aborted/i);
    expect(metricsMock.recordHttpClientTimeout).toHaveBeenCalledWith({ service: 'test-service', timeoutMs: 10 });
  });

  it('returns 400 for submission requests without a file', async () => {
    const deps = {} as unknown as Parameters<typeof createSubmissionWithRepos>[0];
    const req = {
      userId: 'viewer-1',
      userRole: 'viewer',
      channelId: 'channel-1',
      body: {},
      query: {},
      headers: {},
      socket: { remoteAddress: '127.0.0.1' } as unknown as AuthRequest['socket'],
      app: { get: () => undefined },
    } as AuthRequest;
    const res = createRes();

    await createSubmissionWithRepos(deps, req, res as unknown as Response);

    expect(res.statusCode).toBe(400);
    expect((res.body as { errorCode?: string })?.errorCode).toBe('BAD_REQUEST');
  });

  it('shuts down services gracefully on SIGTERM', async () => {
    const handlers: Record<string, () => void> = {};
    const onSpy = vi.spyOn(process, 'on').mockImplementation((event, listener) => {
      handlers[String(event)] = listener as () => void;
      return process;
    });

    let resolveExit: (code: number) => void = () => {};
    const exitPromise = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      resolveExit(code ?? 0);
      return undefined as never;
    }) as never);

    const httpServer = {
      listening: true,
      on: vi.fn(),
      close: vi.fn((cb?: (err?: Error) => void) => cb?.()),
      closeIdleConnections: vi.fn(),
    } as unknown as HttpServer;
    const io = { close: vi.fn((cb?: () => void) => cb?.()) } as unknown as SocketIOServer;

    const aiStop = vi.fn().mockResolvedValue(undefined);
    const chatStop = vi.fn().mockResolvedValue(undefined);
    const closeBullmqConnection = vi.fn().mockResolvedValue(undefined);
    const prismaDisconnect = vi.fn().mockResolvedValue(undefined);

    setupShutdownHandlers({
      httpServer,
      io,
      shutdownTimeoutMs: 2000,
      httpDrainTimeoutMs: 100,
      getChatBotHandle: () => ({ stop: chatStop }),
      getAiModerationWorkerHandle: () => ({ stop: aiStop }),
      closeBullmqConnection,
      prismaDisconnect,
    });

    handlers.SIGTERM?.();
    const exitCode = await exitPromise;

    expect(exitCode).toBe(0);
    expect(aiStop).toHaveBeenCalled();
    expect(chatStop).toHaveBeenCalled();
    expect(io.close).toHaveBeenCalled();
    expect(httpServer.close).toHaveBeenCalled();
    expect(prismaDisconnect).toHaveBeenCalled();
    expect(closeBullmqConnection).toHaveBeenCalled();

    onSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
