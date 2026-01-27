import { Router } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { adminController } from '../controllers/adminController.js';
import { youtubeDefaultBotController } from '../controllers/owner/youtubeDefaultBotController.js';
import { vkvideoDefaultBotController } from '../controllers/owner/vkvideoDefaultBotController.js';
import { twitchDefaultBotController } from '../controllers/owner/twitchDefaultBotController.js';
import { entitlementsController } from '../controllers/owner/entitlementsController.js';
import { channelResolveController } from '../controllers/owner/channelResolveController.js';
import { memeAssetModerationController } from '../controllers/owner/memeAssetModerationController.js';
import { moderatorsController } from '../controllers/owner/moderatorsController.js';
import { ownerResolveLimiter } from '../middleware/rateLimit.js';
import { aiStatusController } from '../controllers/owner/aiStatusController.js';
import { tagModerationController } from '../controllers/owner/tagModeration.js';
import { assertAdmin } from '../utils/accessControl.js';

// Owner-only API (role: admin).
// NOTE: This router is mounted with authenticate + requireBetaAccess in routes/index.ts.
export const ownerRoutes = Router();

ownerRoutes.use((req, res, next) => {
  if (!assertAdmin((req as AuthRequest).userRole, res)) return;
  next();
});

// Wallet management (owner-only)
ownerRoutes.get('/wallets/options', adminController.getWalletOptions);
ownerRoutes.get('/wallets', adminController.getAllWallets);
ownerRoutes.post('/wallets/:userId/:channelId/adjust', adminController.adjustWallet);

// YouTube default bot (global shared sender, admin-only)
ownerRoutes.get('/bots/youtube/default/status', youtubeDefaultBotController.status);
ownerRoutes.get('/bots/youtube/default/link', youtubeDefaultBotController.linkStart);
ownerRoutes.delete('/bots/youtube/default', youtubeDefaultBotController.unlink);

// VKVideo default bot (global shared sender, admin-only)
ownerRoutes.get('/bots/vkvideo/default/status', vkvideoDefaultBotController.status);
ownerRoutes.get('/bots/vkvideo/default/link', vkvideoDefaultBotController.linkStart);
ownerRoutes.delete('/bots/vkvideo/default', vkvideoDefaultBotController.unlink);

// Twitch default bot (global shared sender, admin-only)
ownerRoutes.get('/bots/twitch/default/status', twitchDefaultBotController.status);
ownerRoutes.get('/bots/twitch/default/link', twitchDefaultBotController.linkStart);
ownerRoutes.delete('/bots/twitch/default', twitchDefaultBotController.unlink);

// Channel entitlements (admin-only; subscription gates / feature flags)
ownerRoutes.get('/entitlements/custom-bot', entitlementsController.getCustomBot);
ownerRoutes.post('/entitlements/custom-bot/grant', entitlementsController.grantCustomBot);
ownerRoutes.post('/entitlements/custom-bot/revoke', entitlementsController.revokeCustomBot);
// Safer UX: resolve by provider/externalId (no channelId exposure)
ownerRoutes.get('/channels/resolve', ownerResolveLimiter, channelResolveController.resolve);
ownerRoutes.post(
  '/entitlements/custom-bot/grant-by-provider',
  ownerResolveLimiter,
  entitlementsController.grantCustomBotByProvider
);

// Meme pool moderation (admin-only): affects only pool visibility (does not retroactively remove from channels).
ownerRoutes.get('/meme-assets', memeAssetModerationController.list);
ownerRoutes.post('/meme-assets/:id/hide', memeAssetModerationController.hide);
ownerRoutes.post('/meme-assets/:id/unhide', memeAssetModerationController.unhide);
ownerRoutes.post('/meme-assets/:id/purge', memeAssetModerationController.purge);
ownerRoutes.post('/meme-assets/:id/restore', memeAssetModerationController.restore);

// Tag moderation (admin-only)
ownerRoutes.get('/tag-suggestions', tagModerationController.listSuggestions);
ownerRoutes.post('/tag-suggestions/:id/approve', tagModerationController.approveSuggestion);
ownerRoutes.post('/tag-suggestions/:id/map', tagModerationController.mapSuggestion);
ownerRoutes.post('/tag-suggestions/:id/reject', tagModerationController.rejectSuggestion);
ownerRoutes.get('/tags', tagModerationController.listTags);
ownerRoutes.get('/tag-categories', tagModerationController.listCategories);

// Global moderators management (admin-only)
ownerRoutes.get('/moderators', moderatorsController.list);
ownerRoutes.post('/moderators/:userId/grant', moderatorsController.grant);
ownerRoutes.post('/moderators/:userId/revoke', moderatorsController.revoke);

// AI scheduler status (admin-only)
ownerRoutes.get('/ai/status', aiStatusController.status);
