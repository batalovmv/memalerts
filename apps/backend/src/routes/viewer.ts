import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { activateMemeLimiter } from '../middleware/rateLimit.js';
import { viewerController } from '../controllers/viewerController.js';

export const viewerRoutes = Router();

// Protected routes - require authentication
// These must be defined BEFORE the catch-all /:slug route
viewerRoutes.get('/me', authenticate, (req, res, next) => {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'routes/viewer.ts:/me', message: 'Route handler called', data: { path: req.path, originalUrl: req.originalUrl, baseUrl: req.baseUrl }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => {});
  // #endregion
  viewerController.getMe(req as any, res);
});
viewerRoutes.get('/wallet', authenticate, viewerController.getWallet);
viewerRoutes.get('/memes', authenticate, viewerController.getMemes);
viewerRoutes.post('/memes/:id/activate', authenticate, activateMemeLimiter, viewerController.activateMeme);

// Public route - get channel by slug (no auth required)
// This must be AFTER protected routes to avoid conflicts
viewerRoutes.get('/:slug', viewerController.getChannelBySlug);


