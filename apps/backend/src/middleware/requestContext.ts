import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';

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
    logger.info('http.request', {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      userId: typeof anyReq.userId === 'string' ? anyReq.userId : null,
      channelId: typeof anyReq.channelId === 'string' ? anyReq.channelId : null,
    });
  });

  next();
}


