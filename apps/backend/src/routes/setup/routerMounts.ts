import type { Router } from 'express';
import { authRoutes } from '../auth.js';
import { viewerRoutes } from '../viewer.js';
import { submissionRoutes } from '../submissions.js';
import { streamerRoutes } from '../streamer.js';
import { ownerRoutes } from '../owner.js';
import { moderationRoutes } from '../moderation.js';
import { webhookRoutes } from '../webhooks.js';
import { betaRoutes } from '../beta.js';
import { testRoutes } from '../test.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { authenticate } from '../../middleware/auth.js';
import { requireBetaAccess } from '../../middleware/betaAccess.js';
import { createAdminQueuesRouter } from '../adminQueues.js';
import { assertAdmin } from '../../utils/accessControl.js';

export function registerRouterMounts(app: Router) {
  app.use(
    '/admin/queues',
    authenticate,
    requireBetaAccess,
    (req, res, next) => {
      if (!assertAdmin((req as AuthRequest).userRole, res)) return;
      next();
    },
    createAdminQueuesRouter()
  );

  app.use('/auth', authRoutes);
  app.use('/webhooks', webhookRoutes);
  if (process.env.NODE_ENV === 'test') {
    app.use('/test', testRoutes);
  }

  app.use('/channels', viewerRoutes);
  app.use('/submissions', submissionRoutes);
  app.use('/streamer', authenticate, requireBetaAccess, streamerRoutes);
  app.use('/owner', authenticate, requireBetaAccess, ownerRoutes);
  app.use('/moderation', authenticate, requireBetaAccess, moderationRoutes);
  app.use('/', betaRoutes);
}
