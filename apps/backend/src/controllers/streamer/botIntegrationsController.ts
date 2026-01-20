import { youtubeBotController } from './youtubeBotController.js';
import { twitchBotController } from './twitchBotController.js';
import { vkvideoBotController } from './vkvideoBotController.js';
import { trovoBotController } from './trovoBotController.js';
import { kickBotController } from './kickBotController.js';
import { botSettingsController } from './botSettingsController.js';

export const botIntegrationsController = {
  ...youtubeBotController,
  ...twitchBotController,
  ...vkvideoBotController,
  ...trovoBotController,
  ...kickBotController,
  ...botSettingsController,
};
