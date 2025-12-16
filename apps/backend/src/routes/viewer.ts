import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { activateMemeLimiter } from '../middleware/rateLimit.js';
import { viewerController } from '../controllers/viewerController.js';

export const viewerRoutes = Router();

// Protected routes - require authentication
// These must be defined BEFORE the catch-all /:slug route
viewerRoutes.use(authenticate);

viewerRoutes.get('/me', viewerController.getMe);
viewerRoutes.get('/wallet', viewerController.getWallet);
viewerRoutes.get('/memes', viewerController.getMemes);
viewerRoutes.post('/memes/:id/activate', activateMemeLimiter, viewerController.activateMeme);

// Public route - get channel by slug (no auth required)
// This must be AFTER protected routes to avoid conflicts
viewerRoutes.get('/:slug', viewerController.getChannelBySlug);


