import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { adminController } from '../controllers/adminController.js';

export const adminRoutes = Router();

// authenticate and requireBetaAccess are applied in index.ts before this router
// So we only need to check role here
// Note: authenticate is applied in index.ts, so req.userId is available
adminRoutes.use(requireRole('streamer', 'admin'));

adminRoutes.get('/submissions', adminController.getSubmissions);
adminRoutes.post('/submissions/:id/approve', adminController.approveSubmission);
adminRoutes.post('/submissions/:id/reject', adminController.rejectSubmission);
adminRoutes.get('/memes', adminController.getMemes);
adminRoutes.patch('/memes/:id', adminController.updateMeme);
adminRoutes.delete('/memes/:id', adminController.deleteMeme);
adminRoutes.patch('/channel/settings', adminController.updateChannelSettings);
adminRoutes.get('/twitch/reward/eligibility', adminController.getTwitchRewardEligibility);

// Admin-only routes for wallet management
adminRoutes.get('/wallets', adminController.getAllWallets);
adminRoutes.post('/wallets/:userId/:channelId/adjust', adminController.adjustWallet);

// Promotion management
adminRoutes.get('/promotions', adminController.getPromotions);
adminRoutes.post('/promotions', adminController.createPromotion);
adminRoutes.patch('/promotions/:id', adminController.updatePromotion);
adminRoutes.delete('/promotions/:id', adminController.deletePromotion);

// Statistics
adminRoutes.get('/stats/channel', adminController.getChannelStats);

// OBS overlay token (used to generate unguessable Browser Source URL)
adminRoutes.get('/overlay/token', adminController.getOverlayToken);
adminRoutes.post('/overlay/token/rotate', adminController.rotateOverlayToken);


