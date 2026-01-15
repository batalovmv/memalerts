import rateLimit, { type Options, type ValueDeterminingMiddleware } from 'express-rate-limit';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger.js';
import { maybeCreateRateLimitStore } from '../utils/rateLimitRedisStore.js';

// Get whitelist IPs from environment variable (comma-separated)
const getWhitelistIPs = (): string[] => {
  const whitelist = process.env.RATE_LIMIT_WHITELIST_IPS;
  if (!whitelist) return [];
  return whitelist
    .split(',')
    .map((ip) => ip.trim())
    .filter((ip) => ip.length > 0);
};

const normalizeIP = (value: string | undefined | null): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('::ffff:')) return raw.slice(7);
  return raw;
};

// Get trusted proxy IPs from environment variable (comma-separated)
const getTrustedProxyIPs = (): string[] => {
  const raw = process.env.TRUSTED_PROXY_IPS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((ip) => normalizeIP(ip))
    .filter((ip) => ip.length > 0);
};

const isTrustedProxy = (req: Request): boolean => {
  const trusted = getTrustedProxyIPs();
  if (!trusted.length) return false;
  const remote = normalizeIP(req.socket.remoteAddress || req.ip);
  if (!remote) return false;
  return trusted.includes(remote);
};

const hasForwardedHeaders = (req: Request): boolean => {
  return Boolean(
    req.headers['cf-connecting-ip'] ||
      req.headers['x-real-ip'] ||
      req.headers['x-forwarded-for'] ||
      req.headers['true-client-ip']
  );
};

const logRateLimitBypassAttempt = (req: RequestWithId) => {
  const cached = (req as RequestWithId & { _rateLimitBypassLogged?: boolean })._rateLimitBypassLogged;
  if (cached) return;
  (req as RequestWithId & { _rateLimitBypassLogged?: boolean })._rateLimitBypassLogged = true;
  logger.warn('security.rate_limit.bypass_attempt', {
    requestId: req.requestId ?? null,
    ip: normalizeIP(req.socket.remoteAddress || req.ip) || null,
    path: req.path,
    method: req.method,
    cfConnectingIp: req.headers['cf-connecting-ip'] || null,
    xRealIp: req.headers['x-real-ip'] || null,
    xForwardedFor: req.headers['x-forwarded-for'] || null,
    trueClientIp: req.headers['true-client-ip'] || null,
  });
};

// Get client IP from request (handles proxy headers and Cloudflare)
export const getClientIP = (req: RequestWithId): string => {
  const trusted = isTrustedProxy(req);
  if (!trusted) {
    if (hasForwardedHeaders(req)) {
      logRateLimitBypassAttempt(req);
    }
    return normalizeIP(req.socket.remoteAddress || req.ip) || 'unknown';
  }

  // Priority 1: Check CF-Connecting-IP (Cloudflare header with real client IP)
  // This is the most reliable for Cloudflare-proxied requests
  const cfConnectingIP = req.headers['cf-connecting-ip'];
  if (cfConnectingIP) {
    const ip = Array.isArray(cfConnectingIP) ? cfConnectingIP[0] : cfConnectingIP;
    const normalized = normalizeIP(ip);
    if (normalized && normalized !== 'unknown') return normalized;
  }

  // Priority 2: Check X-Real-IP header (from nginx, this is the real client IP)
  const realIP = req.headers['x-real-ip'];
  if (realIP) {
    const ip = Array.isArray(realIP) ? realIP[0] : realIP;
    const normalized = normalizeIP(ip);
    if (normalized && normalized !== 'unknown') return normalized;
  }

  // Priority 3: Check X-Forwarded-For header (from nginx/proxy/cloudflare)
  // X-Forwarded-For format: "client, proxy1, proxy2"
  // The first IP is usually the real client IP
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const firstIP = normalizeIP(ips.split(',')[0]);
    if (firstIP && firstIP !== 'unknown') return firstIP;
  }

  // Fallback to connection remote address
  return normalizeIP(req.socket.remoteAddress || req.ip) || 'unknown';
};

// Log rate limit events for monitoring
type RequestWithId = Request & { requestId?: string };
type RequestWithUser = Request & { userId?: string };
type RateLimitHandlerOptions = Options;

const resolveLimitMax = (options: RateLimitHandlerOptions, req: Request, res: Response): number => {
  const raw =
    (options as { max?: number | ValueDeterminingMiddleware<number> }).max ??
    (options.limit as number | ValueDeterminingMiddleware<number>);
  if (typeof raw === 'function') {
    try {
      const value = raw(req, res);
      if (value && typeof (value as Promise<number>).then === 'function') return 0;
      return Number.isFinite(value as number) ? (value as number) : 0;
    } catch {
      return 0;
    }
  }
  return Number.isFinite(raw as number) ? (raw as number) : 0;
};

const logRateLimitEvent = (
  type: 'hit' | 'blocked' | 'whitelist',
  req: RequestWithId,
  details?: Record<string, unknown>
) => {
  const clientIP = getClientIP(req);
  const timestamp = new Date().toISOString();
  const logData = {
    type,
    timestamp,
    ip: clientIP,
    path: req.path,
    method: req.method,
    userAgent: req.headers['user-agent'],
    ...details,
  };

  const requestId = req.requestId;
  if (type === 'blocked') logger.warn('security.rate_limit.blocked', { requestId, ...logData });
  else if (type === 'hit') logger.info('security.rate_limit.hit', { requestId, ...logData });
  else logger.info('security.rate_limit.whitelist', { requestId, ...logData });
};

const setRetryAfterHeader = (res: Response) => {
  const resetTime = res.getHeader('X-RateLimit-Reset');
  if (!resetTime) return;
  const resetSeconds = Number(resetTime);
  if (!Number.isFinite(resetSeconds)) return;
  const retryAfter = Math.ceil((resetSeconds * 1000 - Date.now()) / 1000);
  if (retryAfter > 0) {
    res.setHeader('Retry-After', String(retryAfter));
  }
};

// Global rate limiter for all routes (prevents abuse)
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  // Redis-backed store (optional): makes limits consistent across processes/instances.
  // If Redis is not configured, express-rate-limit will use its default memory store.
  store: maybeCreateRateLimitStore('global'),
  skip: (req) => {
    // Skip rate limiting for health check endpoint
    if (req.path === '/health') {
      return true;
    }

    // Check if IP is whitelisted
    const whitelistIPs = getWhitelistIPs();
    if (whitelistIPs.length > 0) {
      const clientIP = getClientIP(req);
      const allPossibleIPs: string[] = [clientIP];
      if (isTrustedProxy(req)) {
        if (req.headers['cf-connecting-ip']) {
          const ip = Array.isArray(req.headers['cf-connecting-ip'])
            ? req.headers['cf-connecting-ip'][0]
            : req.headers['cf-connecting-ip'];
          const normalized = normalizeIP(ip);
          if (normalized) allPossibleIPs.push(normalized);
        }
        if (req.headers['x-real-ip']) {
          const ip = Array.isArray(req.headers['x-real-ip']) ? req.headers['x-real-ip'][0] : req.headers['x-real-ip'];
          const normalized = normalizeIP(ip);
          if (normalized) allPossibleIPs.push(normalized);
        }
        if (req.headers['x-forwarded-for']) {
          const forwarded = Array.isArray(req.headers['x-forwarded-for'])
            ? req.headers['x-forwarded-for'][0]
            : req.headers['x-forwarded-for'];
          forwarded.split(',').forEach((ip) => {
            const normalized = normalizeIP(ip);
            if (normalized) allPossibleIPs.push(normalized);
          });
        }
      }
      const remote = normalizeIP(req.socket.remoteAddress || req.ip);
      if (remote) allPossibleIPs.push(remote);

      const uniqueIPs = [...new Set(allPossibleIPs)];
      const isWhitelisted = whitelistIPs.some((whitelistIP) => uniqueIPs.includes(whitelistIP));

      if (isWhitelisted) {
        // Log whitelist access for monitoring
        logRateLimitEvent('whitelist', req, {
          whitelistedIP: clientIP,
          note: 'Request from whitelisted IP, rate limit skipped',
        });
        return true;
      }
    }

    return false;
  },
  // Custom handler to log and then use default behavior
  handler: (req: RequestWithId, res: Response, _next: NextFunction, options: RateLimitHandlerOptions) => {
    // Log the rate limit hit
    logRateLimitEvent('blocked', req, {
      limit: resolveLimitMax(options, req, res),
      windowMs: options.windowMs ?? 0,
      remaining: res.getHeader('X-RateLimit-Remaining'),
      resetTime: res.getHeader('X-RateLimit-Reset'),
    });

    // Use default handler behavior
    setRetryAfterHeader(res);
    res.status(options.statusCode).json({
      errorCode: 'RATE_LIMITED',
      error: 'Too many requests',
      message: options.message,
    });
  },
});

export const activateMemeLimiter = rateLimit({
  windowMs: 3 * 1000, // 3 seconds
  limit: 1,
  message: 'Too many activation requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: maybeCreateRateLimitStore('activateMeme'),
  skip: (req) => {
    // Check if IP is whitelisted
    const whitelistIPs = getWhitelistIPs();
    if (whitelistIPs.length > 0) {
      const clientIP = getClientIP(req);
      return whitelistIPs.includes(clientIP);
    }
    return false;
  },
  handler: (req: RequestWithId, res: Response, _next: NextFunction, options: RateLimitHandlerOptions) => {
    logRateLimitEvent('blocked', req, {
      limiter: 'activateMeme',
      limit: resolveLimitMax(options, req, res),
      windowMs: options.windowMs ?? 0,
    });
    setRetryAfterHeader(res);
    res.status(options.statusCode).json({
      errorCode: 'RATE_LIMITED',
      error: 'Too many requests',
      message: options.message,
    });
  },
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  // Allow normal "upload a few memes in a row" behavior without tripping on shared IPs (mobile/NAT).
  // Still strict enough to prevent abuse.
  limit: 30,
  message: 'Too many upload requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: maybeCreateRateLimitStore('upload'),
  keyGenerator: (req) => {
    // Prefer per-user limiting for authenticated routes; fallback to IP.
    // This avoids punishing users behind NAT/mobile carriers.
    const authReq = req as RequestWithUser;
    const userId = typeof authReq.userId === 'string' ? authReq.userId : null;
    if (userId) return `user:${userId}`;
    return `ip:${getClientIP(req)}`;
  },
  skip: (req) => {
    // Check if IP is whitelisted
    const whitelistIPs = getWhitelistIPs();
    if (whitelistIPs.length > 0) {
      const clientIP = getClientIP(req);
      return whitelistIPs.includes(clientIP);
    }
    return false;
  },
  handler: (req: RequestWithId, res: Response, _next: NextFunction, options: RateLimitHandlerOptions) => {
    logRateLimitEvent('blocked', req, {
      limiter: 'upload',
      limit: resolveLimitMax(options, req, res),
      windowMs: options.windowMs ?? 0,
    });
    setRetryAfterHeader(res);
    res.status(options.statusCode).json({
      errorCode: 'RATE_LIMITED',
      error: 'Too many requests',
      message: options.message,
    });
  },
});

// Moderator/admin panel actions: keep strict but per-user to avoid shared-IP issues.
// Intended for low-frequency "click actions" (hide/delete/restore/grant/revoke).
export const moderationActionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 60, // 60/min per user (or per IP for guests, but these routes are auth-gated)
  message: 'Too many moderation requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: maybeCreateRateLimitStore('moderationAction'),
  keyGenerator: (req) => {
    const authReq = req as RequestWithUser;
    const userId = typeof authReq.userId === 'string' ? authReq.userId : null;
    if (userId) return `user:${userId}`;
    return `ip:${getClientIP(req)}`;
  },
  handler: (req: RequestWithId, res: Response, _next: NextFunction, options: RateLimitHandlerOptions) => {
    logRateLimitEvent('blocked', req, {
      limiter: 'moderationAction',
      limit: resolveLimitMax(options, req, res),
      windowMs: options.windowMs ?? 0,
    });
    setRetryAfterHeader(res);
    res.status(options.statusCode).json({
      errorCode: 'RATE_LIMITED',
      error: 'Too many requests',
      message: options.message,
    });
  },
});

// Public (token-based) submissions control endpoints for StreamDeck/StreamerBot.
// Keep it strict: this should be triggered rarely (button press), not spammed.
export const publicSubmissionsControlLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 15, // 15/min per IP
  message: 'Too many control requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: maybeCreateRateLimitStore('publicSubmissionsControl'),
  keyGenerator: (req) => `ip:${getClientIP(req)}`,
  skip: (req) => {
    const whitelistIPs = getWhitelistIPs();
    if (whitelistIPs.length > 0) {
      const clientIP = getClientIP(req);
      return whitelistIPs.includes(clientIP);
    }
    return false;
  },
  handler: (req: RequestWithId, res: Response, _next: NextFunction, options: RateLimitHandlerOptions) => {
    logRateLimitEvent('blocked', req, {
      limiter: 'publicSubmissionsControl',
      limit: resolveLimitMax(options, req, res),
      windowMs: options.windowMs ?? 0,
    });
    setRetryAfterHeader(res);
    res.status(options.statusCode).json({
      errorCode: 'RATE_LIMITED',
      error: 'Too many requests',
      message: options.message,
    });
  },
});

// Owner/admin-only resolver limiter (per-user): prevents brute forcing external IDs.
// Intended for endpoints like GET /owner/channels/resolve and grant-by-provider helpers.
export const ownerResolveLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 60, // 60/min per user
  message: 'Too many resolve requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: maybeCreateRateLimitStore('ownerResolve'),
  keyGenerator: (req) => {
    const authReq = req as RequestWithUser;
    const userId = typeof authReq.userId === 'string' ? authReq.userId : null;
    if (userId) return `user:${userId}`;
    return `ip:${getClientIP(req)}`;
  },
  skip: (req) => {
    // Check if IP is whitelisted
    const whitelistIPs = getWhitelistIPs();
    if (whitelistIPs.length > 0) {
      const clientIP = getClientIP(req);
      return whitelistIPs.includes(clientIP);
    }
    return false;
  },
  handler: (req: RequestWithId, res: Response, _next: NextFunction, options: RateLimitHandlerOptions) => {
    logRateLimitEvent('blocked', req, {
      limiter: 'ownerResolve',
      limit: resolveLimitMax(options, req, res),
      windowMs: options.windowMs ?? 0,
    });
    setRetryAfterHeader(res);
    res.status(options.statusCode).json({
      errorCode: 'RATE_LIMITED',
      error: 'Too many requests',
      message: options.message,
    });
  },
});
