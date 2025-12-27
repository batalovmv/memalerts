import rateLimit from 'express-rate-limit';
import { Request } from 'express';
import { logger } from '../utils/logger.js';
import { maybeCreateRateLimitStore } from '../utils/rateLimitRedisStore.js';

// Get whitelist IPs from environment variable (comma-separated)
const getWhitelistIPs = (): string[] => {
  const whitelist = process.env.RATE_LIMIT_WHITELIST_IPS;
  if (!whitelist) return [];
  return whitelist.split(',').map(ip => ip.trim()).filter(ip => ip.length > 0);
};

// Get client IP from request (handles proxy headers and Cloudflare)
const getClientIP = (req: Request): string => {
  // Priority 1: Check CF-Connecting-IP (Cloudflare header with real client IP)
  // This is the most reliable for Cloudflare-proxied requests
  const cfConnectingIP = req.headers['cf-connecting-ip'];
  if (cfConnectingIP) {
    const ip = Array.isArray(cfConnectingIP) ? cfConnectingIP[0] : cfConnectingIP;
    if (ip && ip.trim() && ip !== 'unknown') return ip.trim();
  }
  
  // Priority 2: Check X-Real-IP header (from nginx, this is the real client IP)
  const realIP = req.headers['x-real-ip'];
  if (realIP) {
    const ip = Array.isArray(realIP) ? realIP[0] : realIP;
    if (ip && ip.trim() && ip !== 'unknown') return ip.trim();
  }
  
  // Priority 3: Check X-Forwarded-For header (from nginx/proxy/cloudflare)
  // X-Forwarded-For format: "client, proxy1, proxy2"
  // The first IP is usually the real client IP
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const firstIP = ips.split(',')[0].trim();
    if (firstIP && firstIP !== 'unknown') return firstIP;
  }
  
  // Fallback to connection remote address
  return req.socket.remoteAddress || req.ip || 'unknown';
};

// Log rate limit events for monitoring
const logRateLimitEvent = (type: 'hit' | 'blocked' | 'whitelist', req: Request, details?: any) => {
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
  
  const requestId = (req as any).requestId;
  if (type === 'blocked') logger.warn('security.rate_limit.blocked', { requestId, ...logData });
  else if (type === 'hit') logger.info('security.rate_limit.hit', { requestId, ...logData });
  else logger.info('security.rate_limit.whitelist', { requestId, ...logData });
};

// Global rate limiter for all routes (prevents abuse)
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
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
      
      // Get all possible IPs from headers for whitelist checking
      const allPossibleIPs: string[] = [clientIP];
      if (req.headers['cf-connecting-ip']) {
        const ip = Array.isArray(req.headers['cf-connecting-ip']) ? req.headers['cf-connecting-ip'][0] : req.headers['cf-connecting-ip'];
        if (ip && ip.trim()) allPossibleIPs.push(ip.trim());
      }
      if (req.headers['x-real-ip']) {
        const ip = Array.isArray(req.headers['x-real-ip']) ? req.headers['x-real-ip'][0] : req.headers['x-real-ip'];
        if (ip && ip.trim()) allPossibleIPs.push(ip.trim());
      }
      if (req.headers['x-forwarded-for']) {
        const forwarded = Array.isArray(req.headers['x-forwarded-for']) ? req.headers['x-forwarded-for'][0] : req.headers['x-forwarded-for'];
        forwarded.split(',').forEach(ip => {
          const trimmed = ip.trim();
          if (trimmed) allPossibleIPs.push(trimmed);
        });
      }
      if (req.socket.remoteAddress) allPossibleIPs.push(req.socket.remoteAddress);
      if (req.ip) allPossibleIPs.push(req.ip);
      
      // Check if any of the possible IPs is whitelisted
      const uniqueIPs = [...new Set(allPossibleIPs)];
      const isWhitelisted = whitelistIPs.some(whitelistIP => 
        uniqueIPs.includes(whitelistIP)
      );
      
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
  handler: (req: Request, res: any, next: any, options: any) => {
    // Log the rate limit hit
    logRateLimitEvent('blocked', req, {
      limit: options.max,
      windowMs: options.windowMs,
      remaining: res.getHeader('X-RateLimit-Remaining'),
      resetTime: res.getHeader('X-RateLimit-Reset'),
    });
    
    // Use default handler behavior
    res.status(options.statusCode).json({
      errorCode: 'RATE_LIMITED',
      error: 'Too many requests',
      message: options.message,
    });
  },
});

export const activateMemeLimiter = rateLimit({
  windowMs: 3 * 1000, // 3 seconds
  max: 1,
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
  handler: (req: Request, res: any, next: any, options: any) => {
    logRateLimitEvent('blocked', req, {
      limiter: 'activateMeme',
      limit: options.max,
      windowMs: options.windowMs,
    });
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
  max: 30,
  message: 'Too many upload requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: maybeCreateRateLimitStore('upload'),
  keyGenerator: (req) => {
    // Prefer per-user limiting for authenticated routes; fallback to IP.
    // This avoids punishing users behind NAT/mobile carriers.
    const anyReq = req as any;
    const userId = typeof anyReq.userId === 'string' ? anyReq.userId : null;
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
  handler: (req: Request, res: any, next: any, options: any) => {
    logRateLimitEvent('blocked', req, {
      limiter: 'upload',
      limit: options.max,
      windowMs: options.windowMs,
    });
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
  max: 15, // 15/min per IP
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
  handler: (req: Request, res: any, _next: any, options: any) => {
    logRateLimitEvent('blocked', req, {
      limiter: 'publicSubmissionsControl',
      limit: options.max,
      windowMs: options.windowMs,
    });
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
  max: 60, // 60/min per user
  message: 'Too many resolve requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: maybeCreateRateLimitStore('ownerResolve'),
  keyGenerator: (req) => {
    const anyReq = req as any;
    const userId = typeof anyReq.userId === 'string' ? anyReq.userId : null;
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
  handler: (req: Request, res: any, _next: any, options: any) => {
    logRateLimitEvent('blocked', req, {
      limiter: 'ownerResolve',
      limit: options.max,
      windowMs: options.windowMs,
    });
    res.status(options.statusCode).json({
      errorCode: 'RATE_LIMITED',
      error: 'Too many requests',
      message: options.message,
    });
  },
});


