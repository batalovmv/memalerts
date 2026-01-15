import { botCommandsHandlers } from './bot/botCommands.js';
import { botFollowGreetingsHandlers } from './bot/botFollowGreetings.js';
import { botOutboxHandlers } from './bot/botOutbox.js';
import { botStreamDurationHandlers } from './bot/botStreamDuration.js';
import { botSubscriptionHandlers } from './bot/botSubscription.js';

export const streamerBotController = {
  ...botSubscriptionHandlers,
  ...botOutboxHandlers,
  ...botCommandsHandlers,
  ...botFollowGreetingsHandlers,
  ...botStreamDurationHandlers,
};

export type BotService = typeof streamerBotController;

export const createBotService = (): BotService => streamerBotController;
