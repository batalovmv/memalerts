import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { streamerBotController } from '../controllers/streamer/botController.js';
import { botIntegrationsController } from '../controllers/streamer/botIntegrationsController.js';
import { streamerEntitlementsController } from '../controllers/streamer/entitlementsController.js';
import { submissionsControlController } from '../controllers/streamer/submissionsControlController.js';
import { aiRegenerateController } from '../controllers/streamer/aiRegenerateController.js';
import { addChannelBlocklist, listChannelBlocklist, removeChannelBlocklist } from '../controllers/streamer/channelBlocklistController.js';
import { getStarterMemes } from '../controllers/streamer/starterMemesController.js';

// Streamer control panel API (role: streamer | admin).
// NOTE: This router is mounted with authenticate + requireBetaAccess in routes/index.ts.
export const streamerRoutes = Router();

streamerRoutes.use(requireRole('streamer', 'admin'));

// Meme tools
streamerRoutes.post('/memes/:id/ai/regenerate', aiRegenerateController.regenerate);
streamerRoutes.get('/starter-memes', getStarterMemes);

// Channel-level meme blocklist
streamerRoutes.get('/channel-blocklist', listChannelBlocklist);
streamerRoutes.post('/channel-blocklist', addChannelBlocklist);
streamerRoutes.delete('/channel-blocklist/:memeAssetId', removeChannelBlocklist);

// Public control links (StreamDeck / StreamerBot integrations)
streamerRoutes.get('/submissions-control/link', submissionsControlController.getLink);
streamerRoutes.post('/submissions-control/link/rotate', submissionsControlController.rotate);

// Global chat bot subscription (joins streamer's chat as lotas_bot)
streamerRoutes.post('/bot/enable', streamerBotController.enable);
streamerRoutes.post('/bot/disable', streamerBotController.disable);
streamerRoutes.post('/bot/say', streamerBotController.say);
streamerRoutes.get('/bot/outbox/:provider/:id', streamerBotController.outboxStatus);

// Bot integrations (per-provider toggles; persisted in DB)
streamerRoutes.get('/bots', botIntegrationsController.get);
streamerRoutes.get('/bots/vkvideo/candidates', botIntegrationsController.vkvideoCandidates);
streamerRoutes.get('/bots/vkvideo/bot', botIntegrationsController.vkvideoBotStatus);
streamerRoutes.get('/bots/vkvideo/bot/link', botIntegrationsController.vkvideoBotLinkStart);
streamerRoutes.delete('/bots/vkvideo/bot', botIntegrationsController.vkvideoBotUnlink);
streamerRoutes.get('/bots/twitch/bot', botIntegrationsController.twitchBotStatus);
streamerRoutes.get('/bots/twitch/bot/link', botIntegrationsController.twitchBotLinkStart);
streamerRoutes.delete('/bots/twitch/bot', botIntegrationsController.twitchBotUnlink);
streamerRoutes.get('/bots/youtube/bot', botIntegrationsController.youtubeBotStatus);
streamerRoutes.get('/bots/youtube/bot/link', botIntegrationsController.youtubeBotLinkStart);
streamerRoutes.delete('/bots/youtube/bot', botIntegrationsController.youtubeBotUnlink);
streamerRoutes.get('/bots/trovo/bot', botIntegrationsController.trovoBotStatus);
streamerRoutes.get('/bots/trovo/bot/link', botIntegrationsController.trovoBotLinkStart);
streamerRoutes.delete('/bots/trovo/bot', botIntegrationsController.trovoBotUnlink);
streamerRoutes.get('/bots/kick/bot', botIntegrationsController.kickBotStatus);
streamerRoutes.get('/bots/kick/bot/link', botIntegrationsController.kickBotLinkStart);
streamerRoutes.delete('/bots/kick/bot', botIntegrationsController.kickBotUnlink);
streamerRoutes.patch('/bots/:provider', botIntegrationsController.patch);

// Entitlements / subscription gates
streamerRoutes.get('/entitlements/custom-bot', streamerEntitlementsController.customBot);

// Bot commands CRUD
streamerRoutes.get('/bot/commands', streamerBotController.getCommands);
streamerRoutes.post('/bot/commands', streamerBotController.createCommand);
streamerRoutes.patch('/bot/commands/:id', streamerBotController.patchCommand);
streamerRoutes.delete('/bot/commands/:id', streamerBotController.deleteCommand);

// Bot settings
streamerRoutes.get('/bot/subscription', streamerBotController.subscription);
streamerRoutes.get('/bot/follow-greetings', streamerBotController.getFollowGreetings);
streamerRoutes.post('/bot/follow-greetings/enable', streamerBotController.enableFollowGreetings);
streamerRoutes.post('/bot/follow-greetings/disable', streamerBotController.disableFollowGreetings);
streamerRoutes.patch('/bot/follow-greetings', streamerBotController.patchFollowGreetings);

// Smart bot command: stream duration
streamerRoutes.get('/bot/stream-duration', streamerBotController.getStreamDuration);
streamerRoutes.patch('/bot/stream-duration', streamerBotController.patchStreamDuration);
