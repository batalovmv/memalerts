import type { Router } from 'express';
import { publicSubmissionsControlLimiter } from '../../middleware/rateLimit.js';
import { optionalAuthenticate } from '../../middleware/auth.js';
import { submissionsPublicControlController } from '../../controllers/public/submissionsPublicControlController.js';
import {
  getPublicChannelBySlug,
  getPublicChannelMemes,
  searchPublicChannelMemes,
} from '../../controllers/public/channelPublicController.js';

export function registerPublicRoutes(app: Router) {
  app.get('/public/submissions/status', publicSubmissionsControlLimiter, submissionsPublicControlController.status);
  app.post('/public/submissions/enable', publicSubmissionsControlLimiter, submissionsPublicControlController.enable);
  app.post('/public/submissions/disable', publicSubmissionsControlLimiter, submissionsPublicControlController.disable);
  app.post('/public/submissions/toggle', publicSubmissionsControlLimiter, submissionsPublicControlController.toggle);

  app.get('/public/channels/:slug', optionalAuthenticate, getPublicChannelBySlug);
  app.get('/public/channels/:slug/memes', optionalAuthenticate, getPublicChannelMemes);
  app.get('/public/channels/:slug/memes/search', optionalAuthenticate, searchPublicChannelMemes);
}
