import { Express } from 'express';
import { authRoutes } from './auth.js';
import { viewerRoutes } from './viewer.js';
import { submissionRoutes } from './submissions.js';
import { adminRoutes } from './admin.js';
import { webhookRoutes } from './webhooks.js';
import { betaRoutes } from './beta.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { activateMemeLimiter } from '../middleware/rateLimit.js';
import { requireBetaAccess } from '../middleware/betaAccess.js';
import { viewerController } from '../controllers/viewerController.js';

export function setupRoutes(app: Express) {
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Apply beta access middleware to all routes (except /beta/request, /beta/status, /health, /me, /wallet, /memes)
  // The middleware will check if request is for beta domain and verify access
  // Note: /me, /wallet, /memes are excluded because they use authenticate middleware which sets req.userId
  // requireBetaAccess will be applied after authenticate in those routes
  app.use((req, res, next) => {
    // Skip beta access check for beta access routes, health endpoint, and auth routes
    // Also skip for /me, /wallet, /memes - these will be checked after authenticate middleware
    if (req.path.startsWith('/beta/request') || 
        req.path.startsWith('/beta/status') || 
        req.path === '/health' ||
        req.path.startsWith('/auth/twitch') ||
        req.path === '/me' ||
        req.path === '/wallet' ||
        req.path === '/memes') {
      return next();
    }
    // Apply beta access check (will skip if not beta domain)
    requireBetaAccess(req as AuthRequest, res, next);
  });

  // Register specific routes BEFORE router-based routes to avoid conflicts
  // /me, /wallet, /memes need to be handled directly, not through viewerRoutes
  // because viewerRoutes has /:slug which would conflict
  // Apply authenticate first, then requireBetaAccess (if beta domain)
  app.get('/me', authenticate, requireBetaAccess, viewerController.getMe);
  app.get('/wallet', authenticate, requireBetaAccess, viewerController.getWallet);
  app.get('/memes', authenticate, requireBetaAccess, viewerController.getMemes);
  app.get('/channels/memes/search', viewerController.searchMemes); // Public search endpoint
  app.get('/memes/stats', viewerController.getMemeStats); // Public stats endpoint
  app.post('/memes/:id/activate', authenticate, activateMemeLimiter, viewerController.activateMeme);
  
  // Router-based routes
  app.use('/auth', authRoutes);
  app.use('/webhooks', webhookRoutes);
  app.use('/channels', viewerRoutes);
  app.use('/submissions', submissionRoutes);
  app.use('/admin', adminRoutes);
  app.use('/', betaRoutes); // Beta access routes (mounted at root to avoid /beta/beta/request)
}


