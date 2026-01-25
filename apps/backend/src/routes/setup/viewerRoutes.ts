import type { Router } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { authenticate, optionalAuthenticate } from '../../middleware/auth.js';
import { requireBetaAccess, requireBetaAccessOrGuestForbidden, isBetaDomain } from '../../middleware/betaAccess.js';
import { activateMemeLimiter } from '../../middleware/rateLimit.js';
import { idempotencyKey } from '../../middleware/idempotencyKey.js';
import { viewerController } from '../../controllers/viewerController.js';

export function registerViewerRoutes(app: Router) {
  app.get('/me', authenticate, requireBetaAccess, viewerController.getMe);
  app.get('/me/taste-profile', authenticate, requireBetaAccess, viewerController.getTasteProfile);
  app.get('/me/preferences', authenticate, requireBetaAccess, viewerController.getMePreferences);
  app.patch('/me/preferences', authenticate, requireBetaAccess, viewerController.patchMePreferences);
  app.get('/wallet', authenticate, requireBetaAccess, viewerController.getWallet);
  app.get('/memes', authenticate, requireBetaAccess, viewerController.getMemes);

  app.post('/rewards/youtube/like/claim', authenticate, requireBetaAccess, viewerController.claimYouTubeLikeReward);

  app.get('/channels/:slug', (req, res) => {
    if (isBetaDomain(req)) {
      return optionalAuthenticate(req as AuthRequest, res, () =>
        requireBetaAccessOrGuestForbidden(req as AuthRequest, res, () =>
          viewerController.getChannelBySlug(req as AuthRequest, res)
        )
      );
    }
    return viewerController.getChannelBySlug(req as AuthRequest, res);
  });

  app.get('/channels/:slug/wallet', authenticate, requireBetaAccess, viewerController.getWalletForChannel);
  app.get('/channels/:slug/memes/personalized', authenticate, requireBetaAccess, viewerController.getPersonalizedMemes);
  app.post(
    '/channels/:slug/memes/:memeAssetId/favorite',
    authenticate,
    requireBetaAccess,
    viewerController.addFavorite
  );
  app.delete(
    '/channels/:slug/memes/:memeAssetId/favorite',
    authenticate,
    requireBetaAccess,
    viewerController.removeFavorite
  );
  app.post(
    '/channels/:slug/memes/:memeAssetId/hidden',
    authenticate,
    requireBetaAccess,
    viewerController.addHidden
  );
  app.delete(
    '/channels/:slug/memes/:memeAssetId/hidden',
    authenticate,
    requireBetaAccess,
    viewerController.removeHidden
  );

  app.get('/channels/:slug/memes', (req, res) => {
    if (isBetaDomain(req)) {
      return optionalAuthenticate(req as AuthRequest, res, () =>
        requireBetaAccessOrGuestForbidden(req as AuthRequest, res, () =>
          viewerController.getChannelMemesPublic(req as AuthRequest, res)
        )
      );
    }
    return viewerController.getChannelMemesPublic(req as AuthRequest, res);
  });

  app.get('/channels/memes/search', (req, res) => {
    if (isBetaDomain(req)) {
      return optionalAuthenticate(req as AuthRequest, res, () =>
        requireBetaAccessOrGuestForbidden(req as AuthRequest, res, () =>
          viewerController.searchMemes(req as AuthRequest, res)
        )
      );
    }
    return optionalAuthenticate(req as AuthRequest, res, () => viewerController.searchMemes(req as AuthRequest, res));
  });

  app.get('/memes/stats', (req, res) => {
    if (isBetaDomain(req)) {
      return optionalAuthenticate(req as AuthRequest, res, () =>
        requireBetaAccessOrGuestForbidden(req as AuthRequest, res, () =>
          viewerController.getMemeStats(req as AuthRequest, res)
        )
      );
    }
    return optionalAuthenticate(req as AuthRequest, res, () => viewerController.getMemeStats(req as AuthRequest, res));
  });

  app.get('/memes/pool', (req, res) => {
    if (isBetaDomain(req)) {
      return optionalAuthenticate(req as AuthRequest, res, () =>
        requireBetaAccessOrGuestForbidden(req as AuthRequest, res, () =>
          viewerController.getMemePool(req as AuthRequest, res)
        )
      );
    }
    return viewerController.getMemePool(req as AuthRequest, res);
  });

  app.post(
    '/memes/:id/activate',
    authenticate,
    requireBetaAccess,
    idempotencyKey,
    activateMemeLimiter,
    viewerController.activateMeme
  );
}
