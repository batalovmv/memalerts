import { Express } from 'express';
import { authRoutes } from './auth.js';
import { viewerRoutes } from './viewer.js';
import { submissionRoutes } from './submissions.js';
import { adminRoutes } from './admin.js';
import { webhookRoutes } from './webhooks.js';

export function setupRoutes(app: Express) {
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/auth', authRoutes);
  app.use('/webhooks', webhookRoutes);
  app.use('/me', viewerRoutes);
  app.use('/wallet', viewerRoutes);
  app.use('/memes', viewerRoutes);
  app.use('/submissions', submissionRoutes);
  app.use('/admin', adminRoutes);
}


