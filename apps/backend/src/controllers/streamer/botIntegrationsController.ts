import { youtubeBotController } from './youtubeBotController.js';
import { twitchBotController } from './twitchBotController.js';
import { vkvideoBotController } from './vkvideoBotController.js';
import { botSettingsController } from './botSettingsController.js';

export const botIntegrationsController = {
  ...youtubeBotController,
  ...twitchBotController,
  ...vkvideoBotController,
  ...botSettingsController,
};
