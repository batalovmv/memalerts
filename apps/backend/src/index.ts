import './config/loadEnv.js';
import './tracing/init.js';
import express, { type Request, type Response as ExpressResponse } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
import crypto from 'node:crypto';
import path from 'path';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { Server } from 'socket.io';
import { setupSocketIO } from './socket/index.js';
import { maybeSetupSocketIoRedisAdapter } from './socket/redisAdapter.js';
import { setupRoutes } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { requestContext } from './middleware/requestContext.js';
import { errorResponseFormat } from './middleware/errorResponseFormat.js';
import { metricsMiddleware } from './middleware/metrics.js';
import { startRejectedSubmissionsCleanupScheduler } from './jobs/cleanupRejectedSubmissions.js';
import { startChannelDailyStatsRollupScheduler } from './jobs/channelDailyStatsRollup.js';
import { startTopStats30dRollupScheduler } from './jobs/channelTopStats30dRollup.js';
import { startMemeDailyStatsRollupScheduler } from './jobs/memeDailyStatsRollup.js';
import { startMemeAssetPurgeScheduler } from './jobs/purgeMemeAssets.js';
import { startBoostySubscriptionRewardsScheduler } from './jobs/boostySubscriptionRewards.js';
import { startPendingSubmissionFilesCleanupScheduler } from './jobs/cleanupPendingSubmissionFiles.js';
import { logger } from './utils/logger.js';
import { startTwitchChatBot } from './bots/twitchChatBot.js';
import { startAiModerationWorker } from './workers/aiModerationWorker.js';
import { validateEnv } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { isShuttingDown } from './utils/shutdownState.js';
import { closeBullmqConnection } from './queues/bullmqConnection.js';
import { setupShutdownHandlers } from './server/shutdown.js';
import { initSentry, sentryErrorHandler, sentryRequestHandler } from './observability/sentry.js';

initSentry();

const app = express();
const httpServer = createServer(app);
// Get allowed origins from env or use defaults
// IMPORTANT: Beta and production must be isolated
// - Beta backend should only allow beta frontend
// - Production backend should only allow production frontend
const getAllowedOrigins = () => {
  const origins: string[] = [];

  // Check if this is a beta instance (by checking DOMAIN or PORT)
  const isBetaInstance =
    process.env.DOMAIN?.includes('beta.') ||
    process.env.PORT === '3002' ||
    String(process.env.INSTANCE || '').toLowerCase() === 'beta';

  if (process.env.WEB_URL) {
    // Only add WEB_URL if it matches the instance type (beta or production)
    const webUrlIsBeta = process.env.WEB_URL.includes('beta.');
    if ((isBetaInstance && webUrlIsBeta) || (!isBetaInstance && !webUrlIsBeta)) {
      origins.push(process.env.WEB_URL);
    }
  }

  if (process.env.OVERLAY_URL) {
    origins.push(process.env.OVERLAY_URL);
  }

  if (process.env.DOMAIN) {
    // Only add domain if it matches instance type
    const domainIsBeta = process.env.DOMAIN.includes('beta.');
    if ((isBetaInstance && domainIsBeta) || (!isBetaInstance && !domainIsBeta)) {
      origins.push(`https://${process.env.DOMAIN}`);
      origins.push(`https://www.${process.env.DOMAIN}`);
    }
  }

  // Development fallback
  if (origins.length === 0) {
    origins.push('http://localhost:5173', 'http://localhost:5174');
  }

  return origins;
};

const allowedOrigins = getAllowedOrigins();
const shouldLogSocketOrigins =
  String(process.env.SOCKET_ORIGINS_LOG || '').toLowerCase() === '1' ||
  String(process.env.SOCKET_ORIGINS_LOG || '').toLowerCase() === 'true';
if (shouldLogSocketOrigins) {
  const isBetaInstance = process.env.DOMAIN?.includes('beta.') || process.env.PORT === '3002';
  logger.info('socket.allowed_origins', {
    origins: allowedOrigins,
    instance: isBetaInstance ? 'beta' : 'production',
    domain: process.env.DOMAIN || null,
    webUrl: process.env.WEB_URL || null,
    overlayUrl: process.env.OVERLAY_URL || null,
    port: process.env.PORT || null,
  });
}

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

const PORT = process.env.PORT || 3001;
const SHUTDOWN_TIMEOUT_MS = Number.parseInt(String(process.env.SHUTDOWN_TIMEOUT_MS || '30000'), 10);
const shutdownTimeoutMs = Number.isFinite(SHUTDOWN_TIMEOUT_MS) ? SHUTDOWN_TIMEOUT_MS : 30000;
const HTTP_DRAIN_TIMEOUT_MS = Number.parseInt(String(process.env.HTTP_DRAIN_TIMEOUT_MS || '10000'), 10);
const httpDrainTimeoutMs = Number.isFinite(HTTP_DRAIN_TIMEOUT_MS)
  ? Math.max(1_000, Math.min(HTTP_DRAIN_TIMEOUT_MS, shutdownTimeoutMs))
  : Math.min(10_000, shutdownTimeoutMs);

let chatBotHandle: ReturnType<typeof startTwitchChatBot> | null = null;
let aiModerationWorkerHandle: ReturnType<typeof startAiModerationWorker> = null;

setupShutdownHandlers({
  httpServer,
  io,
  shutdownTimeoutMs,
  httpDrainTimeoutMs,
  getChatBotHandle: () => chatBotHandle,
  getAiModerationWorkerHandle: () => aiModerationWorkerHandle,
  closeBullmqConnection: () => closeBullmqConnection(),
  prismaDisconnect: () => prisma.$disconnect(),
});

// Configure HTTP server timeouts to prevent hanging requests
// Timeout for inactive connections (5 minutes for file uploads)
httpServer.timeout = 300000; // 5 minutes
httpServer.keepAliveTimeout = 65000; // 65 seconds
httpServer.headersTimeout = 66000; // 66 seconds (must be > keepAliveTimeout)
httpServer.on('timeout', (socket) => {
  logger.warn('http.server_timeout_socket_closed', { timeoutMs: httpServer.timeout });
  socket.destroy();
});

// Trust proxy for rate limiting behind reverse proxy (nginx/cloudflare)
// Set to 1 to trust first proxy (nginx), or 2 if behind Cloudflare + nginx
// This prevents express-rate-limit validation error while still allowing IP detection
app.set('trust proxy', 1);

// Middleware
// Attach requestId early and keep access logs controlled (sampling + slow/error logs).
app.use(sentryRequestHandler());
app.use(requestContext);
// Capture per-route metrics before controllers run.
app.use(metricsMiddleware);
// Normalize all error responses to a strict shape: { errorCode, error, requestId, traceId }.
// This keeps API clients consistent even when controllers return legacy { error, message } payloads.
app.use(errorResponseFormat);
// During shutdown, stop accepting new work (health endpoints handle their own 503 responses).
app.use((req, res, next) => {
  if (!isShuttingDown()) return next();
  const path = req.path || '';
  const isHealthEndpoint =
    path === '/health' ||
    path === '/healthz' ||
    path === '/readyz' ||
    path === '/health/workers' ||
    path === '/metrics';
  if (isHealthEndpoint) return next();
  res.setHeader('Connection', 'close');
  return res.status(503).json({
    error: 'Service Unavailable',
    message: 'Server is shutting down',
  });
});

// Optional response compression (JSON/text). Can be disabled if CPU is a bottleneck or if nginx/CDN handles it.
// Env:
// - HTTP_COMPRESSION=0|false disables
// - HTTP_COMPRESSION_THRESHOLD_BYTES=2048 (default in prod), 0 to compress everything
const compressionEnabledRaw = String(process.env.HTTP_COMPRESSION ?? '').toLowerCase();
const compressionEnabled = !(
  compressionEnabledRaw === '0' ||
  compressionEnabledRaw === 'false' ||
  compressionEnabledRaw === 'off'
);
if (compressionEnabled) {
  const thresholdRaw = parseInt(String(process.env.HTTP_COMPRESSION_THRESHOLD_BYTES ?? ''), 10);
  const threshold =
    Number.isFinite(thresholdRaw) && thresholdRaw >= 0
      ? thresholdRaw
      : process.env.NODE_ENV === 'production'
        ? 2048
        : 0;

  app.use(
    compression({
      threshold,
      filter: (req: Request, res: ExpressResponse) => {
        // Do not compress if something already set encoding.
        if (res.getHeader('Content-Encoding')) return false;
        // Avoid compressing static uploads; nginx can handle these better.
        if (req.path && String(req.path).startsWith('/uploads')) return false;
        return compression.filter(req, res);
      },
    })
  );
}

// CSP nonce (required for inline scripts/styles without unsafe-inline).
app.use((_req, res, next) => {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.cspNonce = nonce;
  res.setHeader('X-CSP-Nonce', nonce);
  next();
});

const cspNonce = (_req: IncomingMessage, res: ServerResponse) => {
  const expressRes = res as ExpressResponse;
  return `'nonce-${expressRes.locals.cspNonce}'`;
};
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", cspNonce],
  styleSrc: ["'self'", cspNonce],
  imgSrc: [
    "'self'",
    'data:',
    'blob:',
    'https://static-cdn.jtvnw.net', // Twitch avatars and images
    'https://*.twitch.tv', // Twitch CDN
  ],
  mediaSrc: [
    "'self'",
    'data:',
    'blob:',
    'https://static-cdn.jtvnw.net', // Twitch media
  ],
  connectSrc: [
    "'self'",
    'wss:', // WebSocket for Socket.IO
    'ws:', // WebSocket for Socket.IO (dev)
    'https://id.twitch.tv', // Twitch OAuth
    'https://api.twitch.tv', // Twitch API (if used)
    'https://static-cdn.jtvnw.net', // Twitch CDN
  ],
  fontSrc: ["'self'", 'data:'],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'", 'https://id.twitch.tv'], // Twitch OAuth redirect
  frameAncestors: ["'none'"],
  reportUri: ['/csp-report'],
  upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null, // Only in production
};

if (process.env.CSP_REPORT_ONLY === '1') {
  app.use(
    helmet.contentSecurityPolicy({
      directives: cspDirectives,
      reportOnly: true,
    })
  );
}

// Configure helmet with proper CSP
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: cspDirectives,
    },
  })
);
app.use((_req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
  );
  next();
});
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    // Allow browser JS (frontend) to read pagination + requestId headers on cross-origin requests.
    // If frontend is same-origin, this is harmless.
    exposedHeaders: ['Set-Cookie', 'X-Total', 'X-Limit', 'X-Offset', 'X-Request-Id', 'X-CSP-Nonce'],
  })
);

// CSRF protection for state-changing operations (must be after CORS)
import { csrfProtection } from './middleware/csrf.js';
app.use((req, res, next) => void csrfProtection(req, res, next));
// Body size limits:
// - file uploads use multipart (multer) and are not affected by JSON limits
// - keep JSON/urlencoded limits tight to avoid memory pressure under abusive/bursty traffic
const jsonLimit = String(process.env.JSON_BODY_LIMIT || (process.env.NODE_ENV === 'production' ? '1mb' : '5mb'));
const urlencodedLimit = String(
  process.env.URLENCODED_BODY_LIMIT || (process.env.NODE_ENV === 'production' ? '1mb' : '5mb')
);
// Capture raw JSON body for webhook signature verification (Twitch EventSub signs raw bytes).
// Safe: JSON bodies are size-limited and uploads use multipart (multer) instead of JSON.
app.use(
  express.json({
    limit: jsonLimit,
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  })
);
app.use(cookieParser());
app.use(express.urlencoded({ extended: true, limit: urlencodedLimit }));

// Request timeout middleware for long-running requests (like file uploads)
app.use((req, res, next) => {
  // Set timeout for requests (5 minutes for file uploads)
  const REQUEST_TIMEOUT = 300000; // 5 minutes
  req.setTimeout(REQUEST_TIMEOUT, () => {
    if (!res.headersSent) {
      logger.warn('http.request_timeout', { method: req.method, path: req.path });
      res.status(408).json({
        error: 'Request timeout',
        message: 'Request timed out. Please try again.',
      });
    }
  });
  next();
});

// Static files
const uploadDir = process.env.UPLOAD_DIR || './uploads';
// Back-compat: serve both configured UPLOAD_DIR and the legacy default ./uploads (if they differ).
// This avoids 404s when storage wrote to a different directory than the one being served.
const uploadsRoots = [path.resolve(process.cwd(), uploadDir), path.resolve(process.cwd(), './uploads')];
const uniqueUploadsRoots = Array.from(new Set(uploadsRoots));
const uploadStaticOptions = {
  maxAge: '1y',
  immutable: true,
  etag: true,
  setHeaders: (res: ExpressResponse, filePath: string) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const ext = filePath.split('.').pop()?.toLowerCase();
    const videoExts = ['mp4', 'webm', 'mov', 'avi', 'mkv'];
    if (!videoExts.includes(ext || '')) {
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('Content-Type', 'application/octet-stream');
    }
  },
};
for (const dir of uniqueUploadsRoots) {
  app.use('/uploads', express.static(dir, uploadStaticOptions));
}

// Attach io to app for use in routes
app.set('io', io);

// Global rate limiting (applied to all routes)
app.use(globalLimiter);

// Routes
setupRoutes(app);

// 404 handler for unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', message: `Route ${req.method} ${req.path} not found` });
});

// Socket.IO
setupSocketIO(io);

// Error handler
app.use(sentryErrorHandler());
app.use(errorHandler);

function parseBool(value: string | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

// Test database connection before starting server
async function startServer() {
  validateEnv();

  const skipDbConnect = parseBool(process.env.SKIP_DB_CONNECT);
  if (skipDbConnect) {
    logger.warn('db.connect.skipped', { reason: 'SKIP_DB_CONNECT' });
  } else {
    try {
      // Test database connection
      logger.info('db.connect.testing');
      await prisma.$connect();
      logger.info('db.connect.success');

      // Test a simple query
      await prisma.$queryRaw`SELECT 1`;
      logger.info('db.query.success');
    } catch (error) {
      const err = error as Error;
      logger.error('db.connect.failed', { errorMessage: err.message });
      if (error instanceof Error) {
        logger.error('db.connect.failed_detail', { errorMessage: error.message });
      }
      logger.error('db.connect.checklist', {
        checklist: [
          'DATABASE_URL is correctly set in .env',
          'PostgreSQL is running: sudo systemctl status postgresql',
          'Database and user exist',
          'Password in DATABASE_URL is correct',
        ],
      });
      process.exit(1);
    }
  }

  // Optional: enable Socket.IO redis adapter for horizontal scaling / shared rooms.
  // This is safe to call even if Redis is not configured.
  await maybeSetupSocketIoRedisAdapter(io);

  // Check if port is already in use
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error('server.port_in_use', {
        port: PORT,
        hint: 'Stop the process using this port or use a different port',
        findProcess: `lsof -ti:${PORT}`,
      });
      process.exit(1);
    } else {
      throw err;
    }
  });

  httpServer.listen(PORT, () => {
    logger.info('server.started', { port: PORT, url: `http://localhost:${PORT}` });
    logger.info('db.connection_configured', { configured: !!process.env.DATABASE_URL });
    // Economical storage: cleanup rejected submissions after TTL (default 30 days).
    startRejectedSubmissionsCleanupScheduler();
    // Performance: keep daily stats rollups warm (for admin dashboards / future scale).
    startChannelDailyStatsRollupScheduler();
    // Performance: top-20 rollups (30d) to avoid expensive groupBy at scale.
    startTopStats30dRollupScheduler();
    // Performance: meme daily rollups for viewer stats (day/week/month via 1/7/30).
    startMemeDailyStatsRollupScheduler();
    // Safety: delayed purge of globally hidden MemeAssets (quarantine-based).
    startMemeAssetPurgeScheduler();
    // Boosty: award coins for active subscriptions (manual token linking).
    startBoostySubscriptionRewardsScheduler(io);
    // Optional: BullMQ AI worker (horizontal scaling).
    aiModerationWorkerHandle = startAiModerationWorker();
    // Optional: normalize audio for playback (site + OBS). Disabled by default; guarded by env.
    // Safety: cleanup pending submissions that exceeded AI retry/retention window (avoid disk bloat).
    startPendingSubmissionFilesCleanupScheduler();

    // Optional: Twitch chat bot (collects chatters for credits overlay).
    // Enabled via env (see CHAT_BOT_* vars).
    try {
      chatBotHandle = startTwitchChatBot(io);
    } catch (error) {
      const err = error as { message?: string };
      logger.error('chatbot.start_failed', { errorMessage: err?.message || String(error) });
    }
  });
}

void startServer();
