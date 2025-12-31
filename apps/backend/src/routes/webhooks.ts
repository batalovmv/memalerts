import { Router } from 'express';
import { webhookController } from '../controllers/webhookController.js';
import { kickWebhookController } from '../controllers/kickWebhookController.js';

export const webhookRoutes = Router();

webhookRoutes.post('/twitch/eventsub', webhookController.handleEventSub);
webhookRoutes.post('/kick/events', kickWebhookController.handleEvents);


