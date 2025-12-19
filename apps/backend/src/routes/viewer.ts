import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireBetaAccess } from '../middleware/betaAccess.js';
import { viewerController } from '../controllers/viewerController.js';

export const viewerRoutes = Router();

// Public route - get channel by slug (no auth required)
// This router is only used for /channels/:slug
viewerRoutes.get('/:slug', viewerController.getChannelBySlug);

// Public route - get approved memes for channel (pagination)
viewerRoutes.get('/:slug/memes', viewerController.getChannelMemesPublic);

// Get wallet for specific channel (requires auth)
viewerRoutes.get('/:slug/wallet', authenticate, requireBetaAccess, viewerController.getWalletForChannel);


