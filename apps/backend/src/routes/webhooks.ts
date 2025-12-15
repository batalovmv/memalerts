import { Router } from 'express';
import { webhookController } from '../controllers/webhookController';

export const webhookRoutes = Router();

webhookRoutes.post('/twitch/eventsub', webhookController.handleEventSub);


