import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { adminController } from '../controllers/adminController.js';

// Owner-only API (role: admin).
// NOTE: This router is mounted with authenticate + requireBetaAccess in routes/index.ts.
export const ownerRoutes = Router();

ownerRoutes.use(requireRole('admin'));

// Wallet management (owner-only)
ownerRoutes.get('/wallets/options', adminController.getWalletOptions);
ownerRoutes.get('/wallets', adminController.getAllWallets);
ownerRoutes.post('/wallets/:userId/:channelId/adjust', adminController.adjustWallet);


