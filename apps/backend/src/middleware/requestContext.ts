import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import { runWithRequestContext, getRequestContext } from '../utils/asyncContext.js';

function parseNumberEnv(name: string, fallback: number): number {
  const n = Number.parseFloat(String(process.env[name] ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

function shouldSample(rate: number): boolean {
  if (!Number.isFinite(rate)) return true;
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return Math.random() < rate;
}

function getOrCreateRequestId(req: Request): string {
  const incoming = (req.headers['x-request-id'] || req.headers['x-correlation-id']) as string | string[] | undefined;
  const fromHeader = Array.isArray(incoming) ? incoming[0] : incoming;
  if (fromHeader && typeof fromHeader === 'string' && fromHeader.trim().length > 0) return fromHeader.trim();
  return randomUUID();
}

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const requestId = getOrCreateRequestId(req);
  (req as any).requestId = requestId;
  (res.locals as any).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1_000_000;

    const anyReq = req as any;

    const status = res.statusCode;
    const roundedMs = Math.round(durationMs);

    const sampleRate = parseNumberEnv(
      'HTTP_LOG_SAMPLE_RATE',
      process.env.NODE_ENV === 'production' ? 0.05 : 1
    );
    const slowMs = parseNumberEnv(
      'HTTP_LOG_SLOW_MS',
      process.env.NODE_ENV === 'production' ? 1000 : 2000
    );

    const base = {
      requestId,
      method: req.method,
      path: req.path,
      status,
      durationMs: roundedMs,
      userId: typeof anyReq.userId === 'string' ? anyReq.userId : null,
      channelId: typeof anyReq.channelId === 'string' ? anyReq.channelId : null,
      dbQueryCount: getRequestContext()?.db.queryCount ?? 0,
      dbMs: Math.round(getRequestContext()?.db.totalMs ?? 0),
      dbSlowQueryCount: getRequestContext()?.db.slowQueryCount ?? 0,
    };

    // Always log 5xx, and always log slow requests.
    if (status >= 500) {
      logger.error('http.request', base);
      return;
    }
    if (roundedMs >= slowMs) {
      logger.warn('http.slow', { ...base, slowMs });
      return;
    }

    // Sample the rest to reduce log volume/cost.
    if (shouldSample(sampleRate)) {
      logger.info('http.request', { ...base, sampleRate });
    }
  });

  const store = {
    requestId,
    userId: null,
    channelId: null,
    db: { queryCount: 0, totalMs: 0, slowQueryCount: 0 },
  };

  runWithRequestContext(store, () => next());
}



