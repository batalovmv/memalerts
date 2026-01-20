import type { Router } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { optionalAuthenticate } from '../../middleware/auth.js';
import { debugLog, isDebugAuthEnabled, isDebugLogsEnabled } from '../../utils/debug.js';
import { isBetaDomain } from '../../middleware/betaAccess.js';

export function registerDebugRoutes(app: Router) {
  if (isDebugLogsEnabled()) {
    app.get('/debug-ip', (req, res) => {
      const ipInfo = {
        'cf-connecting-ip': req.headers['cf-connecting-ip'],
        'x-real-ip': req.headers['x-real-ip'],
        'x-forwarded-for': req.headers['x-forwarded-for'],
        'socket.remoteAddress': req.socket.remoteAddress,
        'req.ip': req.ip,
        'all-ip-headers': {
          'cf-connecting-ip': req.headers['cf-connecting-ip'],
          'x-real-ip': req.headers['x-real-ip'],
          'x-forwarded-for': req.headers['x-forwarded-for'],
          'true-client-ip': req.headers['true-client-ip'],
        },
      };
      debugLog('[DEBUG_IP] Request IP info:', ipInfo);
      res.json(ipInfo);
    });
  }

  if (isDebugAuthEnabled()) {
    app.get('/debug-auth', optionalAuthenticate, (req, res) => {
      const r = req as AuthRequest;
      const cookieHeader = typeof req.headers.cookie === 'string' ? String(req.headers.cookie || '') : '';
      const cookieKeys = r.cookies ? Object.keys(r.cookies) : [];
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        requestId: r.requestId ?? null,
        path: req.originalUrl || req.url || null,
        host: req.get('host') || null,
        'x-forwarded-host': req.get('x-forwarded-host') || null,
        'x-forwarded-proto': req.get('x-forwarded-proto') || null,
        hasCookie: cookieHeader.length > 0,
        sessionId:
          (req as AuthRequest & { sessionID?: string; session?: { id?: string } }).sessionID ??
          (req as AuthRequest & { session?: { id?: string } }).session?.id ??
          null,
        userId: r.userId ?? null,
        isBeta: isBetaDomain(req),
        instancePort: process.env.PORT ?? null,
        cookieKeys,
      });
    });
  }
}
