import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { activateMemeLimiter } from '../middleware/rateLimit.js';
import { viewerController } from '../controllers/viewerController.js';

export const viewerRoutes = Router();

// Public route - get channel by slug (no auth required)
// This router is only used for /channels/:slug
viewerRoutes.get('/:slug', viewerController.getChannelBySlug);


