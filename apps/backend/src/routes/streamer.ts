import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { adminController } from '../controllers/adminController.js';
import { streamerBotController } from '../controllers/streamer/botController.js';
import { botIntegrationsController } from '../controllers/streamer/botIntegrationsController.js';
import { streamerEntitlementsController } from '../controllers/streamer/entitlementsController.js';
import { submissionsControlController } from '../controllers/streamer/submissionsControlController.js';
import { aiRegenerateController } from '../controllers/streamer/aiRegenerateController.js';
import { bulkSubmissionsController } from '../controllers/streamer/bulkSubmissionsController.js';
import { addChannelBlocklist, listChannelBlocklist, removeChannelBlocklist } from '../controllers/streamer/channelBlocklistController.js';
import { getStarterMemes } from '../controllers/streamer/starterMemesController.js';
import { getLatestStreamRecap } from '../controllers/streamer/streamRecapController.js';
import { createVote, closeVote, getActiveVote } from '../controllers/streamer/voteController.js';
import { getWheelSettings, updateWheelSettings } from '../controllers/streamer/wheelController.js';

// Streamer control panel API (role: streamer | admin).
// NOTE: This router is mounted with authenticate + requireBetaAccess in routes/index.ts.
export const streamerRoutes = Router();

streamerRoutes.use(requireRole('streamer', 'admin'));

// Submissions moderation
streamerRoutes.get('/submissions', adminController.getSubmissions);
streamerRoutes.post('/submissions/:id/approve', adminController.approveSubmission);
streamerRoutes.post('/submissions/:id/reject', adminController.rejectSubmission);
streamerRoutes.post('/submissions/:id/needs-changes', adminController.needsChangesSubmission);
streamerRoutes.post('/submissions/bulk', bulkSubmissionsController.bulk);

// Memes management
streamerRoutes.get('/memes', adminController.getMemes);
streamerRoutes.patch('/memes/:id', adminController.updateMeme);
streamerRoutes.delete('/memes/:id', adminController.deleteMeme);
streamerRoutes.post('/memes/:id/ai/regenerate', aiRegenerateController.regenerate);
streamerRoutes.get('/starter-memes', getStarterMemes);

// Channel-level meme blocklist
streamerRoutes.get('/channel-blocklist', listChannelBlocklist);
streamerRoutes.post('/channel-blocklist', addChannelBlocklist);
streamerRoutes.delete('/channel-blocklist/:memeAssetId', removeChannelBlocklist);

// Channel settings + rewards
streamerRoutes.patch('/channel/settings', adminController.updateChannelSettings);
streamerRoutes.get('/twitch/reward/eligibility', adminController.getTwitchRewardEligibility);

// Public control links (StreamDeck / StreamerBot integrations)
streamerRoutes.get('/submissions-control/link', submissionsControlController.getLink);
streamerRoutes.post('/submissions-control/link/rotate', submissionsControlController.rotate);

// Promotions (streamer-owned)
streamerRoutes.get('/promotions', adminController.getPromotions);
streamerRoutes.post('/promotions', adminController.createPromotion);
streamerRoutes.patch('/promotions/:id', adminController.updatePromotion);
streamerRoutes.delete('/promotions/:id', adminController.deletePromotion);

// Channel statistics (for the streamer's channel)
streamerRoutes.get('/stats/channel', adminController.getChannelStats);
streamerRoutes.get('/stream-recap/latest', getLatestStreamRecap);
streamerRoutes.get('/votes/active', getActiveVote);
streamerRoutes.post('/votes', createVote);
streamerRoutes.post('/votes/:sessionId/close', closeVote);
streamerRoutes.get('/wheel/settings', getWheelSettings);
streamerRoutes.patch('/wheel/settings', updateWheelSettings);

// OBS overlay
streamerRoutes.get('/overlay/token', adminController.getOverlayToken);
streamerRoutes.post('/overlay/token/rotate', adminController.rotateOverlayToken);
streamerRoutes.get('/overlay/preview-meme', adminController.getOverlayPreviewMeme);
streamerRoutes.get('/overlay/preview-memes', adminController.getOverlayPreviewMemes);
streamerRoutes.get('/overlay/presets', adminController.getOverlayPresets);
streamerRoutes.put('/overlay/presets', adminController.putOverlayPresets);

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
streamerRoutes.patch('/bots/:provider', botIntegrationsController.patch);

// Entitlements / subscription gates
streamerRoutes.get('/entitlements/custom-bot', streamerEntitlementsController.customBot);

// Bot settings
streamerRoutes.get('/bot/subscription', streamerBotController.subscription);
