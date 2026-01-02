import { Express } from 'express';
import { authRoutes } from './auth.js';
import { viewerRoutes } from './viewer.js';
import { submissionRoutes } from './submissions.js';
import { streamerRoutes } from './streamer.js';
import { ownerRoutes } from './owner.js';
import { moderationRoutes } from './moderation.js';
import { webhookRoutes } from './webhooks.js';
import { betaRoutes } from './beta.js';
import { authenticate, AuthRequest, optionalAuthenticate } from '../middleware/auth.js';
import { activateMemeLimiter } from '../middleware/rateLimit.js';
import { requireBetaAccess } from '../middleware/betaAccess.js';
import { isBetaDomain } from '../middleware/betaAccess.js';
import { requireBetaAccessOrGuestForbidden } from '../middleware/betaAccess.js';
import { csrfProtection } from '../middleware/csrf.js';
import { viewerController } from '../controllers/viewerController.js';
import { Server } from 'socket.io';
import { emitWalletUpdated, isInternalWalletRelayRequest, WalletUpdatedEvent } from '../realtime/walletBridge.js';
import { emitSubmissionEvent, isInternalSubmissionRelayRequest, SubmissionEvent } from '../realtime/submissionBridge.js';
import { debugLog, isDebugAuthEnabled, isDebugLogsEnabled } from '../utils/debug.js';
import { creditsInternalController } from '../controllers/internal/creditsInternal.js';
import { submissionsPublicControlController } from '../controllers/public/submissionsPublicControlController.js';
import { getPublicChannelBySlug, getPublicChannelMemes, searchPublicChannelMemes } from '../controllers/public/channelPublicController.js';
import { publicSubmissionsControlLimiter } from '../middleware/rateLimit.js';
import { isLocalhostAddress } from '../utils/isLocalhostAddress.js';
import fs from 'fs';
import path from 'path';

let healthBuildInfoCache: any | null = null;
function getHealthBuildInfo(): any {
  if (healthBuildInfoCache) return healthBuildInfoCache;
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw);
    healthBuildInfoCache = {
      name: pkg?.name ?? null,
      version: pkg?.version ?? null,
      deployTrigger: pkg?._deploy_trigger ?? null,
    };
    return healthBuildInfoCache;
  } catch {
    healthBuildInfoCache = { name: null, version: null, deployTrigger: null };
    return healthBuildInfoCache;
  }
}

export function setupRoutes(app: Express) {
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      build: getHealthBuildInfo(),
      instance: {
        port: process.env.PORT ?? null,
        domain: process.env.DOMAIN ?? null,
        instance: process.env.INSTANCE ?? null,
      },
    });
  });

  // Public (token-based) control endpoints for StreamDeck/StreamerBot.
  // These are intentionally NOT authenticated; protected by a per-channel secret token.
  app.get('/public/submissions/status', publicSubmissionsControlLimiter, submissionsPublicControlController.status);
  app.post('/public/submissions/enable', publicSubmissionsControlLimiter, submissionsPublicControlController.enable);
  app.post('/public/submissions/disable', publicSubmissionsControlLimiter, submissionsPublicControlController.disable);
  app.post('/public/submissions/toggle', publicSubmissionsControlLimiter, submissionsPublicControlController.toggle);

  // Public read endpoints (sanitized DTOs for guest access).
  // UX: public pages & meme lists must be visible to guests on BOTH prod and beta.
  // Actions (activate/favorites/submissions) remain auth-gated elsewhere.
  app.get('/public/channels/:slug', optionalAuthenticate, getPublicChannelBySlug);
  app.get('/public/channels/:slug/memes', optionalAuthenticate, getPublicChannelMemes);
  app.get('/public/channels/:slug/memes/search', optionalAuthenticate, searchPublicChannelMemes);

  // Public OBS Browser Source: Credits overlay (titres).
  // Served by backend so OBS can point to backend domain directly.
  app.get('/overlay/credits/t/:token', (req, res) => {
    const token = String((req.params as any)?.token || '').trim();
    if (!token) return res.status(400).send('Bad Request');

    // No caching: OBS should always get the latest HTML.
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    // IMPORTANT:
    // - We load Socket.IO client from the same origin to satisfy CSP (helmet).
    // - The overlay joins via join:overlay { token } and then listens to credits:* events.
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Credits Overlay</title>
    <style>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #fff; }
      .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
      .panel {
        max-width: 92vw;
        max-height: 92vh;
        padding: 20px 24px;
        background: rgba(0,0,0,0.18);
        border-radius: 20px;
        backdrop-filter: blur(6px);
        box-shadow: 0 0 90px rgba(0,0,0,0.6);
        overflow: hidden;
      }
      .title { font-weight: 800; font-size: 26px; margin: 0 0 12px 0; opacity: 0.95; }
      .list { display: flex; flex-direction: column; gap: 8px; font-weight: 800; font-size: 26px; }
      .section { margin-top: 12px; }
      .section h3 { margin: 0 0 8px 0; font-size: 18px; opacity: 0.8; font-weight: 700; }
      .muted { opacity: 0.7; font-size: 14px; font-weight: 600; }
      .item { display: flex; align-items: center; gap: 10px; }
      .num { min-width: 2.2em; opacity: 0.9; }
      .avatar { width: 28px; height: 28px; border-radius: 999px; object-fit: cover; flex: 0 0 auto; }
      .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="panel" id="panel">
        <div class="title" id="title">Credits</div>
        <div class="muted" id="status">Connecting...</div>
        <div class="section" id="donorsSection" style="display:none;">
          <h3 id="donorsTitle">Donors</h3>
          <div class="list" id="donors"></div>
        </div>
        <div class="section" id="chattersSection" style="display:none;">
          <h3 id="chattersTitle">Chatters</h3>
          <div class="list" id="chatters"></div>
        </div>
      </div>
    </div>
    <script src="/socket.io/socket.io.js"></script>
    <script>
      const TOKEN = ${JSON.stringify(token)};

      const statusEl = document.getElementById('status');
      const donorsSection = document.getElementById('donorsSection');
      const chattersSection = document.getElementById('chattersSection');
      const donorsEl = document.getElementById('donors');
      const chattersEl = document.getElementById('chatters');
      const titleEl = document.getElementById('title');
      const donorsTitleEl = document.getElementById('donorsTitle');
      const chattersTitleEl = document.getElementById('chattersTitle');

      let cfg = { creditsStyleJson: null };
      let renderCfg = {
        titleText: 'Credits',
        donorsTitleText: 'Donors',
        chattersTitleText: 'Chatters',
        showNumbers: false,
        showAvatars: false,
        avatarSize: 28,
        avatarRadius: 999,
      };

      function safeParseJson(s) {
        try { return JSON.parse(s); } catch { return null; }
      }

      function applyStyle(styleJson) {
        if (!styleJson) return;
        const obj = safeParseJson(styleJson);
        if (!obj || typeof obj !== 'object') return;

        const panel = document.getElementById('panel');
        if (obj.fontFamily) {
          const ff = String(obj.fontFamily);
          document.body.style.fontFamily = ff;
          // Apply to headings too (some browsers/styles may override).
          titleEl.style.fontFamily = ff;
          donorsTitleEl.style.fontFamily = ff;
          chattersTitleEl.style.fontFamily = ff;
        }
        const fontSize = Number(obj.fontSize);
        if (Number.isFinite(fontSize)) {
          donorsEl.style.fontSize = fontSize + 'px';
          chattersEl.style.fontSize = fontSize + 'px';
          titleEl.style.fontSize = Math.max(14, Math.round(fontSize * 1.0)) + 'px';
          // Apply the same sizing to section headers as well (user requested same settings as list).
          donorsTitleEl.style.fontSize = fontSize + 'px';
          chattersTitleEl.style.fontSize = fontSize + 'px';
        }
        if (obj.fontWeight) {
          const fw = String(obj.fontWeight);
          donorsEl.style.fontWeight = fw;
          chattersEl.style.fontWeight = fw;
          titleEl.style.fontWeight = fw;
          donorsTitleEl.style.fontWeight = fw;
          chattersTitleEl.style.fontWeight = fw;
        }
        if (obj.fontColor) {
          const fc = String(obj.fontColor);
          document.body.style.color = fc;
          titleEl.style.color = fc;
          donorsTitleEl.style.color = fc;
          chattersTitleEl.style.color = fc;
        }
        const bgOpacity = Number(obj.bgOpacity);
        if (Number.isFinite(bgOpacity)) panel.style.background = 'rgba(0,0,0,' + bgOpacity + ')';
        const blur = Number(obj.blur);
        if (Number.isFinite(blur)) panel.style.backdropFilter = 'blur(' + blur + 'px)';
        const radius = Number(obj.radius);
        if (Number.isFinite(radius)) panel.style.borderRadius = radius + 'px';
        const shadowBlur = Number(obj.shadowBlur);
        const shadowOpacity = Number(obj.shadowOpacity);
        if (Number.isFinite(shadowBlur) && Number.isFinite(shadowOpacity)) {
          panel.style.boxShadow = '0 0 ' + shadowBlur + 'px rgba(0,0,0,' + shadowOpacity + ')';
        }

        // Text labels
        if (typeof obj.titleText === 'string') renderCfg.titleText = obj.titleText.trim() || 'Credits';
        if (typeof obj.donorsTitleText === 'string') renderCfg.donorsTitleText = obj.donorsTitleText.trim() || 'Donors';
        if (typeof obj.chattersTitleText === 'string') renderCfg.chattersTitleText = obj.chattersTitleText.trim() || 'Chatters';
        titleEl.textContent = renderCfg.titleText;
        donorsTitleEl.textContent = renderCfg.donorsTitleText;
        chattersTitleEl.textContent = renderCfg.chattersTitleText;

        // Render options
        renderCfg.showNumbers = Boolean(obj.showNumbers);
        renderCfg.showAvatars = Boolean(obj.showAvatars);
        const avatarSize = Number(obj.avatarSize);
        if (Number.isFinite(avatarSize)) renderCfg.avatarSize = Math.max(12, Math.min(96, Math.round(avatarSize)));
        const avatarRadius = Number(obj.avatarRadius);
        if (Number.isFinite(avatarRadius)) renderCfg.avatarRadius = Math.max(0, Math.min(999, Math.round(avatarRadius)));
      }

      function makeLineItem(index, text, avatarUrl) {
        const wrap = document.createElement('div');
        wrap.className = 'item';

        if (renderCfg.showNumbers) {
          const num = document.createElement('span');
          num.className = 'num';
          num.textContent = String(index + 1) + '.';
          wrap.appendChild(num);
        }

        if (renderCfg.showAvatars && avatarUrl) {
          const img = document.createElement('img');
          img.className = 'avatar';
          img.src = String(avatarUrl);
          img.referrerPolicy = 'no-referrer';
          img.loading = 'lazy';
          img.style.width = renderCfg.avatarSize + 'px';
          img.style.height = renderCfg.avatarSize + 'px';
          img.style.borderRadius = renderCfg.avatarRadius + 'px';
          wrap.appendChild(img);
        }

        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = text || '';
        wrap.appendChild(name);
        return wrap;
      }

      function renderState(state) {
        const donors = Array.isArray(state && state.donors) ? state.donors : [];
        const chatters = Array.isArray(state && state.chatters) ? state.chatters : [];

        donorsEl.innerHTML = '';
        chattersEl.innerHTML = '';

        if (donors.length) {
          donorsSection.style.display = '';
          const sliced = donors.slice(0, 200);
          for (let i = 0; i < sliced.length; i++) {
            const d = sliced[i];
            const name = d && d.name ? String(d.name) : '';
            const amount = d && typeof d.amount === 'number' && d.amount ? d.amount : 0;
            const currency = d && d.currency ? String(d.currency) : '';
            const text = name ? (name + (amount ? (' — ' + amount + ' ' + currency) : '')) : '';
            donorsEl.appendChild(makeLineItem(i, text, d && d.avatarUrl ? String(d.avatarUrl) : null));
          }
        } else {
          donorsSection.style.display = 'none';
        }

        if (chatters.length) {
          chattersSection.style.display = '';
          const sliced = chatters.slice(0, 500);
          for (let i = 0; i < sliced.length; i++) {
            const c = sliced[i];
            const text = c && c.name ? String(c.name) : '';
            chattersEl.appendChild(makeLineItem(i, text, c && c.avatarUrl ? String(c.avatarUrl) : null));
          }
        } else {
          chattersSection.style.display = 'none';
        }
      }

      const socket = io({ transports: ['websocket', 'polling'] });
      socket.on('connect', () => {
        statusEl.textContent = 'Connected';
        socket.emit('join:overlay', { token: TOKEN });
      });
      socket.on('disconnect', () => {
        statusEl.textContent = 'Disconnected';
      });
      socket.on('credits:config', (payload) => {
        cfg = payload || { creditsStyleJson: null };
        applyStyle(cfg.creditsStyleJson);
      });
      socket.on('credits:state', (payload) => {
        statusEl.textContent = 'Live';
        renderState(payload || { donors: [], chatters: [] });
      });
    </script>
  </body>
</html>`;

    return res.status(200).send(html);
  });

  // Internal-only relay endpoint (used to mirror wallet updates between prod/beta backends on the same VPS)
  // Not exposed via nginx public routes; additionally, requires localhost source + internal header.
  app.post('/internal/wallet-updated', (req, res) => {
    const isLocal = isLocalhostAddress(req.socket.remoteAddress);
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
    const isLocal = isLocalhostAddress(req.socket.remoteAddress);
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

  // Internal-only credits events (chat bot / DA proxy). Localhost + internal header required.
  app.post('/internal/credits/chatter', creditsInternalController.chatter);
  app.post('/internal/credits/donor', creditsInternalController.donor);

  // Temporary endpoint to debug IP detection.
  // Must be opt-in via DEBUG_LOGS=1 (beta only) to avoid exposing debug info on production.
  if (isDebugLogsEnabled()) {
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
        },
      };
      debugLog('[DEBUG_IP] Request IP info:', ipInfo);
      res.json(ipInfo);
    });
  }

  // Temporary endpoint to debug auth/cookies/proxy headers.
  // Opt-in via DEBUG_AUTH=1 (or DEBUG_LOGS=1). Keep response minimal; never return tokens.
  if (isDebugAuthEnabled()) {
    app.get('/debug-auth', optionalAuthenticate, (req, res) => {
      const r = req as AuthRequest;
      const cookieHeader = typeof (req.headers as any)?.cookie === 'string' ? String((req.headers as any)?.cookie || '') : '';
      const cookieKeys = r.cookies ? Object.keys(r.cookies) : [];
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        requestId: r.requestId ?? null,
        path: req.originalUrl || req.url || null,
        host: req.get('host') || null,
        'x-forwarded-host': req.get('x-forwarded-host') || null,
        'x-forwarded-proto': req.get('x-forwarded-proto') || null,
        hasCookie: cookieHeader.length > 0,
        sessionId: (req as any)?.sessionID ?? (req as any)?.session?.id ?? null,
        userId: r.userId ?? null,
        isBeta: isBetaDomain(req),
        instancePort: process.env.PORT ?? null,
        cookieKeys,
      });
    });
  }

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
        req.path.startsWith('/public/submissions/') ||
        req.path.startsWith('/public/channels/') ||
        /^\/overlay\/credits\/t\/[^\/]+$/.test(req.path) ||
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
        req.path === '/memes/pool' ||
        req.path.startsWith('/streamer') ||
        req.path.startsWith('/owner') ||
        req.path.startsWith('/moderation') ||
        req.path.startsWith('/submissions') ||
        // Channel routes handled explicitly below (beta: auth+beta; prod: public where applicable)
        /^\/channels\/[^\/]+$/.test(req.path) ||
        /^\/channels\/[^\/]+\/wallet$/.test(req.path) ||
        /^\/channels\/[^\/]+\/memes$/.test(req.path) ||
        // These endpoints are handled explicitly below (prod: public; beta: auth+beta access)
        req.path.startsWith('/channels/memes/search') ||
        req.path === '/memes/stats';
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
  app.get('/me/preferences', authenticate, requireBetaAccess, viewerController.getMePreferences);
  app.patch('/me/preferences', authenticate, requireBetaAccess, viewerController.patchMePreferences);
  app.get('/wallet', authenticate, requireBetaAccess, viewerController.getWallet);
  app.get('/memes', authenticate, requireBetaAccess, viewerController.getMemes);

  // Viewer rewards
  // POST /rewards/youtube/like/claim  body: { channelSlug: string; videoId?: string }
  app.post('/rewards/youtube/like/claim', authenticate, requireBetaAccess, viewerController.claimYouTubeLikeReward);

  // Public on production; gated on beta (auth + requireBetaAccess)
  app.get('/channels/:slug', (req, res) => {
    if (isBetaDomain(req)) {
      // Beta is not public: show beta-required screen even for guests.
      return optionalAuthenticate(req as AuthRequest, res, () =>
        requireBetaAccessOrGuestForbidden(req as AuthRequest, res, () => viewerController.getChannelBySlug(req as any, res))
      );
    }
    return viewerController.getChannelBySlug(req as any, res);
  });

  // Wallet for specific channel: requires auth everywhere; on beta also requires beta access.
  app.get('/channels/:slug/wallet', authenticate, requireBetaAccess, viewerController.getWalletForChannel);

  // Public on production; gated on beta (auth + requireBetaAccess)
  app.get('/channels/:slug/memes', (req, res, next) => {
    if (isBetaDomain(req)) {
      // Beta is not public: show beta-required screen even for guests.
      return optionalAuthenticate(req as AuthRequest, res, () =>
        requireBetaAccessOrGuestForbidden(req as AuthRequest, res, () => viewerController.getChannelMemesPublic(req as AuthRequest, res))
      );
    }
    return viewerController.getChannelMemesPublic(req as AuthRequest, res);
  });
  // Search endpoint:
  // - Production: public (optionally uses auth to enable "favorites"/uploader search)
  // - Beta: gated (auth + requireBetaAccess), because beta is not public
  app.get('/channels/memes/search', (req, res) => {
    if (isBetaDomain(req)) {
      // Beta is not public: show beta-required screen even for guests.
      return optionalAuthenticate(req as AuthRequest, res, () =>
        requireBetaAccessOrGuestForbidden(req as AuthRequest, res, () => viewerController.searchMemes(req as any, res))
      );
    }
    return optionalAuthenticate(req as AuthRequest, res, () => viewerController.searchMemes(req as any, res));
  });

  // Stats endpoint:
  // - Production: public (optionally uses auth to exclude "self" from viewer stats)
  // - Beta: gated (auth + requireBetaAccess)
  app.get('/memes/stats', (req, res) => {
    if (isBetaDomain(req)) {
      // Beta is not public: show beta-required screen even for guests.
      return optionalAuthenticate(req as AuthRequest, res, () =>
        requireBetaAccessOrGuestForbidden(req as AuthRequest, res, () => viewerController.getMemeStats(req as any, res))
      );
    }
    return optionalAuthenticate(req as AuthRequest, res, () => viewerController.getMemeStats(req as any, res));
  });

  // Global meme pool (public in production; beta gated).
  app.get('/memes/pool', (req, res) => {
    if (isBetaDomain(req)) {
      // Beta is not public: show beta-required screen even for guests.
      return optionalAuthenticate(req as AuthRequest, res, () =>
        requireBetaAccessOrGuestForbidden(req as AuthRequest, res, () => viewerController.getMemePool(req as any, res))
      );
    }
    return viewerController.getMemePool(req as any, res);
  });
  // Activation is a user-paid action (wallet) and must be authenticated everywhere.
  // On beta, it is additionally gated by requireBetaAccess.
  app.post('/memes/:id/activate', authenticate, requireBetaAccess, activateMemeLimiter, viewerController.activateMeme);
  
  // Router-based routes
  app.use('/auth', authRoutes);
  app.use('/webhooks', webhookRoutes);
  // IMPORTANT: must be declared before `app.use('/channels', viewerRoutes)` because viewerRoutes contains `/:slug`.
  app.get('/channels/:channelId/boosty-access', authenticate, requireBetaAccess, viewerController.getBoostyAccessForChannel);
  app.use('/channels', viewerRoutes);
  app.use('/submissions', submissionRoutes);
  // Panel routes:
  // - /streamer/*: streamer/admin panel endpoints
  // - /owner/*: owner-only endpoints
  // - /moderation/*: global pool moderation endpoints (admin + global moderators)
  // All are authenticated and beta-gated on beta.
  app.use('/streamer', authenticate, requireBetaAccess, streamerRoutes);
  app.use('/owner', authenticate, requireBetaAccess, ownerRoutes);
  app.use('/moderation', authenticate, requireBetaAccess, moderationRoutes);
  app.use('/', betaRoutes); // Beta access routes (mounted at root to avoid /beta/beta/request)
}


