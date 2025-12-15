import { Express } from 'express';
import { authRoutes } from './auth';
import { viewerRoutes } from './viewer';
import { submissionRoutes } from './submissions';
import { adminRoutes } from './admin';
import { webhookRoutes } from './webhooks';

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


