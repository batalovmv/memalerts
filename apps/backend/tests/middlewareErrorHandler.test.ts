import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ZodError } from 'zod';
import { z } from 'zod';

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../src/utils/logger.js', () => ({ logger: loggerMock }));
vi.mock('../src/tracing/traceContext.js', () => ({ getActiveTraceId: vi.fn(() => 'trace-ctx') }));

import { ERROR_CODES } from '../src/shared/errors.js';
import { ApiError } from '../src/shared/apiError.js';
import { CircuitBreakerOpenError } from '../src/utils/circuitBreaker.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { errorResponseFormat } from '../src/middleware/errorResponseFormat.js';

const baseEnv = { ...process.env };

type TestResponse = {
  statusCode: number;
  headersSent: boolean;
  locals: Record<string, unknown>;
  body?: unknown;
  status: (code: number) => TestResponse;
  json: (body: unknown) => TestResponse;
};

function makeRes(): TestResponse {
  const res: TestResponse = {
    statusCode: 200,
    headersSent: false,
    locals: {},
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

beforeEach(() => {
  process.env = { ...baseEnv, NODE_ENV: 'development' };
  loggerMock.error.mockReset();
  loggerMock.warn.mockReset();
});

afterEach(() => {
  process.env = { ...baseEnv };
  vi.restoreAllMocks();
});

describe('middleware: errorHandler', () => {
  it('handles ApiError with details', () => {
    const err = new ApiError({
      status: 400,
      errorCode: ERROR_CODES.BAD_REQUEST,
      message: 'Bad payload',
      details: { field: 'title' },
    });
    const req = { method: 'POST', path: '/test', requestId: 'req-1', traceId: 'trace-1' };
    const res = makeRes();
    const next = vi.fn();

    errorHandler(err, req as never, res as never, next);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      errorCode: ERROR_CODES.BAD_REQUEST,
      error: 'Bad payload',
      requestId: 'req-1',
      traceId: 'trace-1',
      details: { field: 'title' },
    });
  });

  it('maps ZodError to validation error', () => {
    const schema = z.object({ title: z.string().min(1) });
    const err = schema.safeParse({ title: '' }).error as ZodError;
    const req = { method: 'POST', path: '/test' };
    const res = makeRes();

    errorHandler(err, req as never, res as never, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ errorCode: ERROR_CODES.VALIDATION_ERROR });
  });

  it('maps unauthorized and forbidden errors', () => {
    const req = { method: 'GET', path: '/test' };

    const resUnauthorized = makeRes();
    errorHandler(new Error('Unauthorized'), req as never, resUnauthorized as never, vi.fn());
    expect(resUnauthorized.statusCode).toBe(401);
    expect(resUnauthorized.body).toMatchObject({ errorCode: ERROR_CODES.UNAUTHORIZED });

    const resForbidden = makeRes();
    errorHandler(new Error('Forbidden'), req as never, resForbidden as never, vi.fn());
    expect(resForbidden.statusCode).toBe(403);
    expect(resForbidden.body).toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN });
  });

  it('maps circuit breaker open and multer errors', () => {
    const req = { method: 'GET', path: '/test' };

    const resCircuit = makeRes();
    errorHandler(new CircuitBreakerOpenError('twitch', null), req as never, resCircuit as never, vi.fn());
    expect(resCircuit.statusCode).toBe(503);
    expect(resCircuit.body).toMatchObject({ errorCode: ERROR_CODES.RELAY_UNAVAILABLE });

    const multerErr = new Error('too large') as Error & { code?: string };
    multerErr.code = 'LIMIT_FILE_SIZE';
    const resMulter = makeRes();
    errorHandler(multerErr, req as never, resMulter as never, vi.fn());
    expect(resMulter.statusCode).toBe(413);
    expect(resMulter.body).toMatchObject({ errorCode: ERROR_CODES.FILE_TOO_LARGE });
  });

  it('maps timeout and connection errors', () => {
    const req = { method: 'POST', path: '/test' };

    const timeoutErr = new Error('request timeout');
    const resTimeout = makeRes();
    errorHandler(timeoutErr, req as never, resTimeout as never, vi.fn());
    expect(resTimeout.statusCode).toBe(408);
    expect(resTimeout.body).toMatchObject({ errorCode: ERROR_CODES.TIMEOUT });

    const connErr = new Error('reset') as Error & { code?: string };
    connErr.code = 'ECONNRESET';
    const resConn = makeRes();
    errorHandler(connErr, req as never, resConn as never, vi.fn());
    expect(resConn.statusCode).toBe(408);
    expect(resConn.body).toMatchObject({ errorCode: ERROR_CODES.TIMEOUT });
  });

  it('hides error details in production', () => {
    process.env.NODE_ENV = 'production';
    const err = new Error('Sensitive info');
    const req = { method: 'GET', path: '/test' };
    const res = makeRes();

    errorHandler(err, req as never, res as never, vi.fn());

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ errorCode: ERROR_CODES.INTERNAL_ERROR });
    expect((res.body as { error?: string }).error).toBeDefined();
  });
});

describe('middleware: errorResponseFormat', () => {
  it('normalizes error responses with requestId and traceId', () => {
    const req = { requestId: 'req-1', traceId: 'trace-1' };
    const res = makeRes();
    res.statusCode = 400;

    const originalJson = vi.fn();
    res.json = originalJson as unknown as TestResponse['json'];

    errorResponseFormat(req as never, res as never, vi.fn());

    res.json({ errorCode: ERROR_CODES.BAD_REQUEST, message: 'Specific error', details: { foo: 'bar' } });

    expect(originalJson).toHaveBeenCalledWith({
      errorCode: ERROR_CODES.BAD_REQUEST,
      error: 'Specific error',
      requestId: 'req-1',
      traceId: 'trace-1',
      details: { foo: 'bar' },
    });
  });

  it('derives errorCode from error field and preserves message', () => {
    const req = { requestId: 'req-2' };
    const res = makeRes();
    res.statusCode = 403;

    const originalJson = vi.fn();
    res.json = originalJson as unknown as TestResponse['json'];

    errorResponseFormat(req as never, res as never, vi.fn());

    res.json({ error: ERROR_CODES.FORBIDDEN, message: 'Custom message' });

    expect(originalJson).toHaveBeenCalledWith({
      errorCode: ERROR_CODES.FORBIDDEN,
      error: 'Custom message',
      hint: 'You do not have permission for this action.',
      requestId: 'req-2',
      traceId: 'trace-ctx',
    });
  });
});
