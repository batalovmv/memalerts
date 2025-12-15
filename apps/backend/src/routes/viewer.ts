import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { activateMemeLimiter } from '../middleware/rateLimit';
import { viewerController } from '../controllers/viewerController';

export const viewerRoutes = Router();

viewerRoutes.use(authenticate);

viewerRoutes.get('/me', viewerController.getMe);
viewerRoutes.get('/wallet', viewerController.getWallet);
viewerRoutes.get('/memes', viewerController.getMemes);
viewerRoutes.post('/memes/:id/activate', activateMemeLimiter, viewerController.activateMeme);


