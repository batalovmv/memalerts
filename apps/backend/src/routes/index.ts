import { Express } from 'express';
import { authRoutes } from './auth.js';
import { viewerRoutes } from './viewer.js';
import { submissionRoutes } from './submissions.js';
import { adminRoutes } from './admin.js';
import { webhookRoutes } from './webhooks.js';
import { authenticate } from '../middleware/auth.js';
import { activateMemeLimiter } from '../middleware/rateLimit.js';
import { viewerController } from '../controllers/viewerController.js';

export function setupRoutes(app: Express) {
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // #region agent log
  app.use((req, res, next) => {
    fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'routes/index.ts:setupRoutes', message: 'Incoming request', data: { method: req.method, path: req.path, url: req.url, originalUrl: req.originalUrl }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => {});
    next();
  });
  // #endregion

  // Register specific routes BEFORE router-based routes to avoid conflicts
  // /me, /wallet, /memes need to be handled directly, not through viewerRoutes
  // because viewerRoutes has /:slug which would conflict
  app.get('/me', (req, res, next) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'routes/index.ts:/me', message: '/me route matched', data: { method: req.method, path: req.path, url: req.url, originalUrl: req.originalUrl, hasCookie: !!req.cookies.token, cookies: req.cookies }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run5', hypothesisId: 'I' }) }).catch(() => {});
    // #endregion
    authenticate(req, res, next);
  }, viewerController.getMe);
  app.get('/wallet', authenticate, viewerController.getWallet);
  app.get('/memes', authenticate, viewerController.getMemes);
  app.post('/memes/:id/activate', authenticate, activateMemeLimiter, viewerController.activateMeme);
  
  // Router-based routes
  app.use('/auth', authRoutes);
  app.use('/webhooks', webhookRoutes);
  app.use('/channels', viewerRoutes);
  app.use('/submissions', submissionRoutes);
  app.use('/admin', adminRoutes);
}


