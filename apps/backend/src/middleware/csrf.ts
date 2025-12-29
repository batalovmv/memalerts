import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { logSecurityEvent } from '../utils/auditLogger.js';
import { logger } from '../utils/logger.js';
import { isDebugLogsEnabled } from '../utils/debug.js';

function isDebugCsrfEnabled(): boolean {
  if (isDebugLogsEnabled()) return true;
  const v = String(process.env.DEBUG_CSRF ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function normalizeOrigin(input: string | undefined | null): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  // If it's already an origin, URL() will still accept it.
  // If it's a full URL with path/query, normalize to its origin.
  try {
    const u = new URL(raw);
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Get allowed origins for CSRF validation
 * Should match CORS allowed origins
 */
function getAllowedOrigins(): string[] {
  const origins = new Set<string>();
  
  // Check if this is a beta instance
  const isBetaInstance = process.env.DOMAIN?.includes('beta.') || process.env.PORT === '3002';
  
  if (process.env.WEB_URL) {
    const webUrlNormalized = normalizeOrigin(process.env.WEB_URL);
    const webUrlIsBeta = (() => {
      if (!webUrlNormalized) return process.env.WEB_URL.includes('beta.');
      try {
        return new URL(webUrlNormalized).hostname.includes('beta.');
      } catch {
        return process.env.WEB_URL.includes('beta.');
      }
    })();
    if ((isBetaInstance && webUrlIsBeta) || (!isBetaInstance && !webUrlIsBeta)) {
      if (webUrlNormalized) origins.add(webUrlNormalized);
    }
  }
  
  if (process.env.OVERLAY_URL) {
    const overlayUrlNormalized = normalizeOrigin(process.env.OVERLAY_URL);
    if (overlayUrlNormalized) origins.add(overlayUrlNormalized);
  }
  
  if (process.env.DOMAIN) {
    const domainIsBeta = process.env.DOMAIN.includes('beta.');
    if ((isBetaInstance && domainIsBeta) || (!isBetaInstance && !domainIsBeta)) {
      const a = normalizeOrigin(`https://${process.env.DOMAIN}`);
      const b = normalizeOrigin(`https://www.${process.env.DOMAIN}`);
      if (a) origins.add(a);
      if (b) origins.add(b);
    }
  }
  
  // Development fallback
  if (origins.size === 0) {
    origins.add('http://localhost:5173');
    origins.add('http://localhost:5174');
  }
  
  return Array.from(origins);
}

/**
 * Extract origin from request headers
 */
function getRequestOrigin(req: Request): string | null {
  // Check Origin header first (more reliable for CORS)
  const origin = req.headers.origin;
  if (origin) {
    return origin;
  }
  
  // Fallback to Referer header
  const referer = req.headers.referer;
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      return refererUrl.origin;
    } catch {
      // Invalid referer URL
      return null;
    }
  }
  
  return null;
}

/**
 * CSRF protection middleware for state-changing operations
 * Validates that the request Origin/Referer matches allowed origins
 * 
 * This protects against Cross-Site Request Forgery attacks by ensuring
 * that state-changing requests (POST, PUT, DELETE, PATCH) come from
 * trusted origins.
 */
export async function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // Only protect state-changing methods
  const stateChangingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
  if (!stateChangingMethods.includes(req.method)) {
    return next();
  }

  // Skip CSRF for internal localhost-only relay endpoints
  if (req.path.startsWith('/internal/')) {
    return next();
  }
  
  // Skip CSRF check for webhooks (they use HMAC verification instead)
  if (req.path.startsWith('/webhooks')) {
    return next();
  }
  
  // Skip CSRF check for health checks and public endpoints
  if (req.path === '/health' || req.path.startsWith('/auth/twitch') || req.path.startsWith('/public/')) {
    return next();
  }

  const shouldDebugThisRoute =
    isDebugCsrfEnabled() &&
    (req.method === 'POST' &&
      (req.path === '/auth/logout' ||
        req.path === '/submissions' ||
        req.path === '/me/preferences' ||
        req.path.startsWith('/auth/')));
  
  // Get request origin
  const requestOrigin = getRequestOrigin(req);

  if (shouldDebugThisRoute) {
    logger.info('security.csrf.debug', {
      requestId: (req as any).requestId,
      method: req.method,
      path: req.path,
      host: req.get('host') || null,
      forwardedHost: req.get('x-forwarded-host') || null,
      forwardedProto: req.get('x-forwarded-proto') || null,
      forwardedPort: req.get('x-forwarded-port') || null,
      originHeader: req.get('origin') || null,
      refererHeader: req.get('referer') || null,
      computedRequestOrigin: requestOrigin,
      allowedOrigins: getAllowedOrigins(),
    });
  }
  
  // If no origin is present, it might be a same-origin request
  // In production, we should require origin for security
  // In development, we allow requests without origin (e.g., Postman, curl)
  if (!requestOrigin) {
    if (process.env.NODE_ENV === 'production') {
      logger.warn('security.csrf.missing_origin', {
        requestId: (req as any).requestId,
        method: req.method,
        path: req.path,
      });
      return res.status(403).json({
        errorCode: 'CSRF_INVALID',
        error: 'CSRF validation failed',
        message: 'CSRF protection: Origin header is required for state-changing operations',
      });
    }
    // In development, allow requests without origin
    return next();
  }
  
  // Validate origin against allowed origins
  const allowedOrigins = getAllowedOrigins();
  const isAllowed = allowedOrigins.some(allowedOrigin => {
    // Exact match
    if (requestOrigin === allowedOrigin) {
      return true;
    }
    // Allow localhost variations in development
    if (process.env.NODE_ENV !== 'production') {
      if (requestOrigin.startsWith('http://localhost:') || requestOrigin.startsWith('http://127.0.0.1:')) {
        return true;
      }
    }
    return false;
  });
  
  if (!isAllowed) {
    logger.warn('security.csrf.blocked', {
      requestId: (req as any).requestId,
      origin: requestOrigin,
      method: req.method,
      path: req.path,
    });
    
    // Log security event
    const authReq = req as AuthRequest;
    await logSecurityEvent(
      'csrf_blocked',
      authReq.userId || null,
      authReq.channelId || null,
      {
        origin: requestOrigin,
        method: req.method,
        path: req.path,
        allowedOrigins,
      },
      req
    );
    
    return res.status(403).json({
      errorCode: 'CSRF_INVALID',
      error: 'CSRF validation failed',
      message: 'CSRF protection: Request origin is not allowed',
    });
  }
  
  next();
}

