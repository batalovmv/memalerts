import type { Router } from 'express';
import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { logger } from '../../utils/logger.js';

export function registerCspReportRoute(app: Router) {
  app.post('/csp-report', express.json({ type: ['application/csp-report'] }), (req, res) => {
    const payload = req.body as Record<string, unknown> | undefined;
    const report =
      payload && typeof payload === 'object' && 'csp-report' in payload
        ? (payload['csp-report'] as Record<string, unknown>)
        : (payload ?? null);
    logger.warn('security.csp_violation', {
      requestId: (req as AuthRequest).requestId ?? null,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') || null,
      referrer: req.get('referer') || null,
      report,
    });
    return res.status(204).send();
  });
}
