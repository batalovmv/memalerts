import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { adminController } from '../controllers/adminController.js';

// Streamer control panel API (role: streamer | admin).
// NOTE: This router is mounted with authenticate + requireBetaAccess in routes/index.ts.
export const streamerRoutes = Router();

streamerRoutes.use(requireRole('streamer', 'admin'));

// Submissions moderation
streamerRoutes.get('/submissions', adminController.getSubmissions);
streamerRoutes.post('/submissions/:id/approve', adminController.approveSubmission);
streamerRoutes.post('/submissions/:id/reject', adminController.rejectSubmission);

// Memes management
streamerRoutes.get('/memes', adminController.getMemes);
streamerRoutes.patch('/memes/:id', adminController.updateMeme);
streamerRoutes.delete('/memes/:id', adminController.deleteMeme);

// Channel settings + rewards
streamerRoutes.patch('/channel/settings', adminController.updateChannelSettings);
streamerRoutes.get('/twitch/reward/eligibility', adminController.getTwitchRewardEligibility);

// Promotions (streamer-owned)
streamerRoutes.get('/promotions', adminController.getPromotions);
streamerRoutes.post('/promotions', adminController.createPromotion);
streamerRoutes.patch('/promotions/:id', adminController.updatePromotion);
streamerRoutes.delete('/promotions/:id', adminController.deletePromotion);

// Channel statistics (for the streamer's channel)
streamerRoutes.get('/stats/channel', adminController.getChannelStats);

// OBS overlay
streamerRoutes.get('/overlay/token', adminController.getOverlayToken);
streamerRoutes.post('/overlay/token/rotate', adminController.rotateOverlayToken);
streamerRoutes.get('/overlay/preview-meme', adminController.getOverlayPreviewMeme);


