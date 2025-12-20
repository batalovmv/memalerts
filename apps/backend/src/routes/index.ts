import { Express } from 'express';
import { authRoutes } from './auth.js';
import { viewerRoutes } from './viewer.js';
import { submissionRoutes } from './submissions.js';
import { adminRoutes } from './admin.js';
import { webhookRoutes } from './webhooks.js';
import { betaRoutes } from './beta.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { activateMemeLimiter } from '../middleware/rateLimit.js';
import { requireBetaAccess } from '../middleware/betaAccess.js';
import { isBetaDomain } from '../middleware/betaAccess.js';
import { csrfProtection } from '../middleware/csrf.js';
import { viewerController } from '../controllers/viewerController.js';
import { Server } from 'socket.io';
import { emitWalletUpdated, isInternalWalletRelayRequest, WalletUpdatedEvent } from '../realtime/walletBridge.js';
import { emitSubmissionEvent, isInternalSubmissionRelayRequest, SubmissionEvent } from '../realtime/submissionBridge.js';

export function setupRoutes(app: Express) {
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Internal-only relay endpoint (used to mirror wallet updates between prod/beta backends on the same VPS)
  // Not exposed via nginx public routes; additionally, requires localhost source + internal header.
  app.post('/internal/wallet-updated', (req, res) => {
    const remote = req.socket.remoteAddress || '';
    const isLocal = remote === '127.0.0.1' || remote === '::1' || remote.endsWith('127.0.0.1');
    if (!isLocal || !isInternalWalletRelayRequest(req.headers as any)) {
      return res.status(404).json({ error: 'Not Found' });
    }

    const body = req.body as Partial<WalletUpdatedEvent>;
    if (!body.userId || !body.channelId || typeof body.balance !== 'number') {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const io = app.get('io') as Server;
    emitWalletUpdated(io, body as WalletUpdatedEvent);
    return res.json({ ok: true });
  });

  // Internal-only relay endpoint (used to mirror submission events between prod/beta backends on the same VPS)
  // Not exposed via nginx public routes; additionally, requires localhost source + internal header.
  app.post('/internal/submission-event', (req, res) => {
    const remote = req.socket.remoteAddress || '';
    const isLocal = remote === '127.0.0.1' || remote === '::1' || remote.endsWith('127.0.0.1');
    if (!isLocal || !isInternalSubmissionRelayRequest(req.headers as any)) {
      return res.status(404).json({ error: 'Not Found' });
    }

    const body = req.body as Partial<SubmissionEvent>;
    if (!body.event || !body.submissionId || !body.channelId || !body.channelSlug) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const io = app.get('io') as Server;
    emitSubmissionEvent(io, body as SubmissionEvent);
    return res.json({ ok: true });
  });

  // Temporary endpoint to debug IP detection (remove after IP is identified)
  app.get('/debug-ip', (req, res) => {
    const ipInfo = {
      'cf-connecting-ip': req.headers['cf-connecting-ip'],
      'x-real-ip': req.headers['x-real-ip'],
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'socket.remoteAddress': req.socket.remoteAddress,
      'req.ip': req.ip,
      'all-ip-headers': {
        'cf-connecting-ip': req.headers['cf-connecting-ip'],
        'x-real-ip': req.headers['x-real-ip'],
        'x-forwarded-for': req.headers['x-forwarded-for'],
        'true-client-ip': req.headers['true-client-ip'],
      }
    };
    console.log('[DEBUG_IP] Request IP info:', JSON.stringify(ipInfo, null, 2));
    res.json(ipInfo);
  });

  // Apply beta access middleware to all routes (except public routes and routes that use authenticate)
  // The middleware will check if request is for beta domain and verify access
  // Note: /me, /wallet, /memes are excluded because they use authenticate middleware which sets req.userId
  // requireBetaAccess will be applied after authenticate in those routes
  app.use((req, res, next) => {
    const isBeta = isBetaDomain(req);
    // Skip beta access check for:
    // - Beta access routes
    // - Health endpoint
    // - Auth routes
    // - Public routes (/channels/:slug, /channels/memes/search, /memes/stats)
    // - Routes that use authenticate middleware (/me, /wallet, /memes, /channels/:slug/wallet)
    // - Static files (/uploads)
    // On beta: keep the allow-list minimal. Everything else must go through auth + requireBetaAccess.
    const isSkipped = req.path.startsWith('/beta/request') ||
        req.path.startsWith('/beta/status') ||
        req.path === '/health' ||
        req.path.startsWith('/auth/twitch') ||
        req.path === '/auth/logout' || // Logout doesn't require authentication
        req.path.startsWith('/uploads') || // Static files should not require beta access
        // This route runs authenticate + requireBetaAccess explicitly below.
        // IMPORTANT: requireBetaAccess needs req.userId which is set by authenticate.
        /^\/memes\/[^\/]+\/activate$/.test(req.path) ||
        // Routes that will run authenticate + requireBetaAccess explicitly
        req.path === '/me' ||
        req.path === '/wallet' ||
        req.path === '/memes' ||
        req.path.startsWith('/admin') ||
        req.path.startsWith('/submissions') ||
        // Channel routes handled explicitly below (beta: auth+beta; prod: public where applicable)
        /^\/channels\/[^\/]+$/.test(req.path) ||
        /^\/channels\/[^\/]+\/wallet$/.test(req.path) ||
        /^\/channels\/[^\/]+\/memes$/.test(req.path) ||
        // Keep public endpoints on production only (beta should be gated)
        (!isBeta && (req.path.startsWith('/channels/memes/search') ||
          req.path === '/memes/stats' ||
          /^\/channels\/[^\/]+$/.test(req.path) ||
          /^\/channels\/[^\/]+\/wallet$/.test(req.path)));
    if (isSkipped) {
      return next();
    }
    // Apply beta access check (will skip if not beta domain)
    requireBetaAccess(req as AuthRequest, res, next);
  });

  // Register specific routes BEFORE router-based routes to avoid conflicts
  // /me, /wallet, /memes need to be handled directly, not through viewerRoutes
  // because viewerRoutes has /:slug which would conflict
  // Apply authenticate first, then requireBetaAccess (if beta domain)
  app.get('/me', authenticate, requireBetaAccess, viewerController.getMe);
  app.get('/wallet', authenticate, requireBetaAccess, viewerController.getWallet);
  app.get('/memes', authenticate, requireBetaAccess, viewerController.getMemes);

  // Public on production; gated on beta (auth + requireBetaAccess)
  app.get('/channels/:slug', (req, res) => {
    if (isBetaDomain(req)) {
      return authenticate(req as AuthRequest, res, () =>
        requireBetaAccess(req as AuthRequest, res, () => viewerController.getChannelBySlug(req as any, res))
      );
    }
    return viewerController.getChannelBySlug(req as any, res);
  });

  // Wallet for specific channel: requires auth everywhere; on beta also requires beta access.
  app.get('/channels/:slug/wallet', authenticate, requireBetaAccess, viewerController.getWalletForChannel);

  // Public on production; gated on beta (auth + requireBetaAccess)
  app.get('/channels/:slug/memes', (req, res, next) => {
    if (isBetaDomain(req)) {
      return authenticate(req as AuthRequest, res, () => requireBetaAccess(req as AuthRequest, res, () => viewerController.getChannelMemesPublic(req as AuthRequest, res)));
    }
    return viewerController.getChannelMemesPublic(req as AuthRequest, res);
  });
  app.get('/channels/memes/search', viewerController.searchMemes); // Public search endpoint
  app.get('/memes/stats', viewerController.getMemeStats); // Public stats endpoint
  // Activation is a user-paid action (wallet) and must be authenticated everywhere.
  // On beta, it is additionally gated by requireBetaAccess.
  app.post('/memes/:id/activate', authenticate, requireBetaAccess, activateMemeLimiter, viewerController.activateMeme);
  
  // Router-based routes
  app.use('/auth', authRoutes);
  app.use('/webhooks', webhookRoutes);
  app.use('/channels', viewerRoutes);
  app.use('/submissions', submissionRoutes);
  // Apply authenticate and requireBetaAccess to admin routes
  // authenticate is applied in adminRoutes, but requireBetaAccess needs to be applied here
  app.use('/admin', authenticate, requireBetaAccess, adminRoutes);
  app.use('/', betaRoutes); // Beta access routes (mounted at root to avoid /beta/beta/request)
}


