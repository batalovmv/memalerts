import { botOutboxHandlers } from './bot/botOutbox.js';
import { botSubscriptionHandlers } from './bot/botSubscription.js';

export const streamerBotController = {
  ...botSubscriptionHandlers,
  ...botOutboxHandlers,
};

export type BotService = typeof streamerBotController;

export const createBotService = (): BotService => streamerBotController;
