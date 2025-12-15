import { Router } from 'express';
import { webhookController } from '../controllers/webhookController.js';

export const webhookRoutes = Router();

webhookRoutes.post('/twitch/eventsub', webhookController.handleEventSub);


