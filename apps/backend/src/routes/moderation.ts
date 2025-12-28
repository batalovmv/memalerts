import { Router } from 'express';
import { requireGlobalModerator } from '../middleware/moderator.js';
import { moderationMemeAssetController } from '../controllers/moderation/memeAssetModerationController.js';
import { moderationActionLimiter } from '../middleware/rateLimit.js';

// Global pool moderation routes:
// - Admin always allowed
// - Otherwise requires active GlobalModerator grant (revokedAt IS NULL)
export const moderationRoutes = Router();

moderationRoutes.use(requireGlobalModerator());

moderationRoutes.get('/meme-assets', moderationMemeAssetController.list);
moderationRoutes.post('/meme-assets/:id/hide', moderationActionLimiter, moderationMemeAssetController.hide);
moderationRoutes.post('/meme-assets/:id/unhide', moderationActionLimiter, moderationMemeAssetController.unhide);
moderationRoutes.post('/meme-assets/:id/delete', moderationActionLimiter, moderationMemeAssetController.del);


