import { Router } from 'express';
import { authController } from '../controllers/authController.js';

export const authRoutes = Router();

authRoutes.get('/twitch', authController.initiateTwitchAuth);
authRoutes.get('/twitch/callback', authController.handleTwitchCallback);
authRoutes.get('/twitch/complete', authController.completeBetaAuth);
authRoutes.post('/logout', authController.logout);


