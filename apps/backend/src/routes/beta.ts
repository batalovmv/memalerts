import { Router } from 'express';
import { betaAccessController } from '../controllers/betaAccessController.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/auth.js';

export const betaRoutes = Router();

// Public routes (require auth but not beta access)
betaRoutes.post('/beta/request', authenticate, betaAccessController.requestAccess);
betaRoutes.get('/beta/status', authenticate, betaAccessController.getStatus);

// Owner-only routes (role: admin).
betaRoutes.get('/owner/beta/requests', authenticate, requireRole('admin'), betaAccessController.getAllRequests);
betaRoutes.post('/owner/beta/requests/:id/approve', authenticate, requireRole('admin'), betaAccessController.approveRequest);
betaRoutes.post('/owner/beta/requests/:id/reject', authenticate, requireRole('admin'), betaAccessController.rejectRequest);
betaRoutes.get('/owner/beta/users', authenticate, requireRole('admin'), betaAccessController.getGrantedUsers);
betaRoutes.get('/owner/beta/users/revoked', authenticate, requireRole('admin'), betaAccessController.getRevokedUsers);
betaRoutes.post('/owner/beta/users/:userId/revoke', authenticate, requireRole('admin'), betaAccessController.revokeUserAccess);
betaRoutes.post('/owner/beta/users/:userId/restore', authenticate, requireRole('admin'), betaAccessController.restoreUserAccess);

