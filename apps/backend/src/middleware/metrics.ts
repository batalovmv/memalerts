import type { Request, Response, NextFunction } from 'express';
import { recordHttpRequest } from '../utils/metrics.js';

function resolveRouteLabel(req: Request): string {
  const routePath = (req as Request & { route?: { path?: string } })?.route?.path;
  const baseUrl = req.baseUrl || '';
  if (routePath) return `${baseUrl}${routePath}` || req.path || 'unknown';
  if (baseUrl) return baseUrl;
  return 'unmatched';
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationSeconds = Number(end - start) / 1_000_000_000;
    const route = resolveRouteLabel(req);
    recordHttpRequest({
      method: req.method,
      route,
      status: res.statusCode,
      durationSeconds,
    });
  });

  next();
}
