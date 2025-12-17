import { Router } from 'express';
import { betaAccessController } from '../controllers/betaAccessController.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/auth.js';

export const betaRoutes = Router();

// Public routes (require auth but not beta access)
betaRoutes.post('/beta/request', authenticate, betaAccessController.requestAccess);
betaRoutes.get('/beta/status', authenticate, betaAccessController.getStatus);

// Admin routes
betaRoutes.get('/admin/beta/requests', authenticate, requireRole('admin'), betaAccessController.getAllRequests);
betaRoutes.post('/admin/beta/requests/:id/approve', authenticate, requireRole('admin'), betaAccessController.approveRequest);
betaRoutes.post('/admin/beta/requests/:id/reject', authenticate, requireRole('admin'), betaAccessController.rejectRequest);

