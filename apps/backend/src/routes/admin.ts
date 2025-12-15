import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { adminController } from '../controllers/adminController';

export const adminRoutes = Router();

adminRoutes.use(authenticate);
adminRoutes.use(requireRole('streamer', 'admin'));

adminRoutes.get('/submissions', adminController.getSubmissions);
adminRoutes.post('/submissions/:id/approve', adminController.approveSubmission);
adminRoutes.post('/submissions/:id/reject', adminController.rejectSubmission);
adminRoutes.get('/memes', adminController.getMemes);
adminRoutes.patch('/memes/:id', adminController.updateMeme);
adminRoutes.patch('/channel/settings', adminController.updateChannelSettings);


