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


  // Register specific routes BEFORE router-based routes to avoid conflicts
  // /me, /wallet, /memes need to be handled directly, not through viewerRoutes
  // because viewerRoutes has /:slug which would conflict
  app.get('/me', authenticate, viewerController.getMe);
  app.get('/wallet', authenticate, viewerController.getWallet);
  app.get('/memes', authenticate, viewerController.getMemes);
  app.get('/channels/memes/search', viewerController.searchMemes); // Public search endpoint
  app.get('/memes/stats', viewerController.getMemeStats); // Public stats endpoint
  app.post('/memes/:id/activate', authenticate, activateMemeLimiter, viewerController.activateMeme);
  
  // Router-based routes
  app.use('/auth', authRoutes);
  app.use('/webhooks', webhookRoutes);
  app.use('/channels', viewerRoutes);
  app.use('/submissions', submissionRoutes);
  app.use('/admin', adminRoutes);
}


