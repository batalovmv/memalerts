import { Router } from 'express';
import { authController } from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';

export const authRoutes = Router();

// Backward-compatible Twitch endpoints (kept for older frontends)
authRoutes.get('/twitch', authController.initiateTwitchAuth);
authRoutes.get('/twitch/callback', authController.handleTwitchCallback);
authRoutes.get('/twitch/complete', authController.completeBetaAuth);

// Account linking management (must be before "/:provider" routes)
authRoutes.get('/accounts', authenticate, authController.listAccounts);
authRoutes.delete('/accounts/:externalAccountId', authenticate, authController.unlinkAccount);

// Special YouTube linking: request force-ssl scope (used for viewer activity rewards like videos.getRating).
authRoutes.get('/youtube/link/force-ssl', authenticate, authController.initiateYouTubeForceSslLink);

// New multi-provider endpoints
authRoutes.get('/:provider', authController.initiateAuth);
authRoutes.get('/:provider/callback', authController.handleCallback);
authRoutes.get('/:provider/link', authenticate, authController.initiateLink);
authRoutes.get('/:provider/link/callback', authController.handleLinkCallback);
authRoutes.post('/logout', authController.logout);
