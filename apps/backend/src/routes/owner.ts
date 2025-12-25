import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { adminController } from '../controllers/adminController.js';
import { youtubeDefaultBotController } from '../controllers/owner/youtubeDefaultBotController.js';

// Owner-only API (role: admin).
// NOTE: This router is mounted with authenticate + requireBetaAccess in routes/index.ts.
export const ownerRoutes = Router();

ownerRoutes.use(requireRole('admin'));

// Wallet management (owner-only)
ownerRoutes.get('/wallets/options', adminController.getWalletOptions);
ownerRoutes.get('/wallets', adminController.getAllWallets);
ownerRoutes.post('/wallets/:userId/:channelId/adjust', adminController.adjustWallet);

// YouTube default bot (global shared sender, admin-only)
ownerRoutes.get('/bots/youtube/default/status', youtubeDefaultBotController.status);
ownerRoutes.get('/bots/youtube/default/link', youtubeDefaultBotController.linkStart);
ownerRoutes.delete('/bots/youtube/default', youtubeDefaultBotController.unlink);


