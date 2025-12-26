import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { logSecurityEvent } from '../utils/auditLogger.js';
import { logger } from '../utils/logger.js';

/**
 * Get allowed origins for CSRF validation
 * Should match CORS allowed origins
 */
function getAllowedOrigins(): string[] {
  const origins: string[] = [];
  
  // Check if this is a beta instance
  const isBetaInstance = process.env.DOMAIN?.includes('beta.') || process.env.PORT === '3002';
  
  if (process.env.WEB_URL) {
    const webUrlIsBeta = process.env.WEB_URL.includes('beta.');
    if ((isBetaInstance && webUrlIsBeta) || (!isBetaInstance && !webUrlIsBeta)) {
      origins.push(process.env.WEB_URL);
    }
  }
  
  if (process.env.OVERLAY_URL) {
    origins.push(process.env.OVERLAY_URL);
  }
  
  if (process.env.DOMAIN) {
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
  
  // Get request origin
  const requestOrigin = getRequestOrigin(req);
  
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
        error: 'Forbidden',
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
      error: 'Forbidden',
      message: 'CSRF protection: Request origin is not allowed',
    });
  }
  
  next();
}

