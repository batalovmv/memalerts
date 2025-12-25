import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { adminController } from '../controllers/adminController.js';
import { streamerBotController } from '../controllers/streamer/botController.js';
import { botIntegrationsController } from '../controllers/streamer/botIntegrationsController.js';

// Streamer control panel API (role: streamer | admin).
// NOTE: This router is mounted with authenticate + requireBetaAccess in routes/index.ts.
export const streamerRoutes = Router();

streamerRoutes.use(requireRole('streamer', 'admin'));

// Submissions moderation
streamerRoutes.get('/submissions', adminController.getSubmissions);
streamerRoutes.post('/submissions/:id/approve', adminController.approveSubmission);
streamerRoutes.post('/submissions/:id/reject', adminController.rejectSubmission);
streamerRoutes.post('/submissions/:id/needs-changes', adminController.needsChangesSubmission);

// Memes management
streamerRoutes.get('/memes', adminController.getMemes);
streamerRoutes.patch('/memes/:id', adminController.updateMeme);
streamerRoutes.delete('/memes/:id', adminController.deleteMeme);

// Channel settings + rewards
streamerRoutes.patch('/channel/settings', adminController.updateChannelSettings);
streamerRoutes.get('/twitch/reward/eligibility', adminController.getTwitchRewardEligibility);

// Promotions (streamer-owned)
streamerRoutes.get('/promotions', adminController.getPromotions);
streamerRoutes.post('/promotions', adminController.createPromotion);
streamerRoutes.patch('/promotions/:id', adminController.updatePromotion);
streamerRoutes.delete('/promotions/:id', adminController.deletePromotion);

// Channel statistics (for the streamer's channel)
streamerRoutes.get('/stats/channel', adminController.getChannelStats);

// OBS overlay
streamerRoutes.get('/overlay/token', adminController.getOverlayToken);
streamerRoutes.post('/overlay/token/rotate', adminController.rotateOverlayToken);
streamerRoutes.get('/overlay/preview-meme', adminController.getOverlayPreviewMeme);
streamerRoutes.get('/overlay/preview-memes', adminController.getOverlayPreviewMemes);
streamerRoutes.get('/overlay/presets', adminController.getOverlayPresets);
streamerRoutes.put('/overlay/presets', adminController.putOverlayPresets);

// OBS credits overlay (titres)
streamerRoutes.get('/credits/token', adminController.getCreditsToken);
streamerRoutes.post('/credits/settings', adminController.saveCreditsSettings);
streamerRoutes.post('/credits/token/rotate', adminController.rotateCreditsToken);
streamerRoutes.post('/credits/reset', adminController.resetCredits);
streamerRoutes.post('/credits/reconnect-window', adminController.setCreditsReconnectWindow);

// Global chat bot subscription (joins streamer's chat as lotas_bot)
streamerRoutes.post('/bot/enable', streamerBotController.enable);
streamerRoutes.post('/bot/disable', streamerBotController.disable);
streamerRoutes.post('/bot/say', streamerBotController.say);
streamerRoutes.get('/bot/outbox/:provider/:id', streamerBotController.outboxStatus);

// Bot integrations (per-provider toggles; persisted in DB)
streamerRoutes.get('/bots', botIntegrationsController.get);
streamerRoutes.patch('/bots/:provider', botIntegrationsController.patch);

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


