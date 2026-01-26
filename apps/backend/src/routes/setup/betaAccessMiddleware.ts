import type { Router } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireBetaAccess } from '../../middleware/betaAccess.js';
import { isDebugAuthEnabled, isDebugLogsEnabled } from '../../utils/debug.js';

export function registerBetaAccessMiddleware(app: Router) {
  app.use((req, res, next) => {
    const allowDebugIp = isDebugLogsEnabled();
    const allowDebugAuth = isDebugAuthEnabled();
    const isSkipped =
      req.path.startsWith('/beta/request') ||
      req.path.startsWith('/beta/status') ||
      req.path === '/docs' ||
      req.path.startsWith('/docs/') ||
      req.path === '/health' ||
      req.path === '/healthz' ||
      req.path === '/readyz' ||
      req.path === '/health/workers' ||
      req.path === '/metrics' ||
      req.path === '/csp-report' ||
      req.path.startsWith('/admin/queues') ||
      req.path.startsWith('/public/submissions/') ||
      req.path.startsWith('/public/channels/') ||
      /^\/overlay\/credits\/t\/[^\/]+$/.test(req.path) ||
      req.path.startsWith('/auth/twitch') ||
      req.path === '/auth/logout' ||
      req.path.startsWith('/uploads') ||
      /^\/memes\/[0-9a-fA-F-]{36}$/.test(req.path) ||
      /^\/memes\/[^\/]+\/activate$/.test(req.path) ||
      req.path === '/me' ||
      req.path === '/me/preferences' ||
      req.path === '/wallet' ||
      req.path === '/memes' ||
      req.path === '/memes/pool' ||
      req.path.startsWith('/streamer') ||
      req.path.startsWith('/owner') ||
      req.path.startsWith('/moderation') ||
      req.path.startsWith('/submissions') ||
      /^\/channels\/[^\/]+$/.test(req.path) ||
      /^\/channels\/[^\/]+\/wallet$/.test(req.path) ||
      /^\/channels\/[^\/]+\/memes$/.test(req.path) ||
      /^\/channels\/[^\/]+\/leaderboard$/.test(req.path) ||
      req.path.startsWith('/channels/memes/search') ||
      req.path === '/memes/stats' ||
      (allowDebugIp && req.path === '/debug-ip') ||
      (allowDebugAuth && req.path === '/debug-auth');
    if (isSkipped) {
      return next();
    }
    void requireBetaAccess(req as AuthRequest, res, next);
  });
}
