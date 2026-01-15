import type { Request, Response, NextFunction } from 'express';
import { verifyJwtWithRotation } from '../utils/jwt.js';
import { logger } from '../utils/logger.js';
import { isDebugAuthEnabled } from '../utils/debug.js';
import { getRequestContext } from '../utils/asyncContext.js';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  channelId?: string;
  requestId?: string;
  traceId?: string | null;
  idempotencyKey?: string;
}

function isBetaDomain(req: Request): boolean {
  // IMPORTANT: do NOT rely only on Host header for beta detection.
  // Behind nginx, Host may be a shared API domain, while the instance itself is beta (PORT=3002).
  // Also, some clients hit beta API through a proxy while Origin is beta.*.
  // Prefer proxy hints if present. Some nginx setups rewrite Host for upstreams.
  const forwardedHost = (req.get('x-forwarded-host') || '').split(',')[0]?.trim() || '';
  const host = (req.get('host') || '').split(',')[0]?.trim() || '';
  const domain = process.env.DOMAIN || '';
  const origin = req.get('origin') || '';
  const forwardedProto = (req.get('x-forwarded-proto') || '').split(',')[0]?.trim() || '';
  const forwardedPort = (req.get('x-forwarded-port') || '').split(',')[0]?.trim() || '';

  const isBetaInstance =
    domain.includes('beta.') ||
    String(process.env.PORT || '') === '3002' ||
    String(process.env.INSTANCE || '').toLowerCase() === 'beta';

  const isBetaByRequestHints =
    forwardedHost.includes('beta.') ||
    host.includes('beta.') ||
    origin.includes('beta.') ||
    forwardedPort === '3002' ||
    // Some proxies may expose scheme as a hint (rare, but cheap).
    forwardedProto.includes('beta');

  return isBetaInstance || isBetaByRequestHints;
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  // IMPORTANT:
  // - Production and beta use different JWT secrets.
  // - If we reuse the same cookie name across subdomains (Domain=twitchmemes.ru),
  //   the prod cookie can be sent to beta and break auth with 401.
  // - Therefore beta uses a dedicated cookie name: token_beta.
  const isBeta = isBetaDomain(req);
  const cookieToken = isBeta ? (req.cookies?.token_beta ?? req.cookies?.token) : req.cookies?.token;
  const authHeader = String(req.get('authorization') || '').trim();
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice('bearer '.length).trim() : '';
  const token = cookieToken || bearerToken;

  const originalUrl = (req.originalUrl || req.url || '').toString();
  const shouldDebugThisRoute =
    isDebugAuthEnabled() && (originalUrl.startsWith('/me') || originalUrl.startsWith('/moderation'));
  const cookieHeader = typeof req.headers.cookie === 'string' ? req.headers.cookie : '';
  const hasCookie = cookieHeader.length > 0;
  const sessionReq = req as Request & { sessionID?: string; session?: { id?: string } };
  const sessionId = sessionReq.sessionID ?? sessionReq.session?.id ?? null;

  if (!token) {
    if (shouldDebugThisRoute) {
      logger.info('auth.debug', {
        stage: 'no_token',
        requestId: req.requestId,
        path: originalUrl,
        host: req.get('host') || null,
        forwardedProto: req.get('x-forwarded-proto') || null,
        hasCookie,
        sessionId,
        userId: req.userId || null,
        isBeta,
        instancePort: process.env.PORT || null,
      });
    }
    // Avoid logging secrets: only log presence of cookie keys.
    const cookieKeys = req.cookies ? Object.keys(req.cookies) : [];
    logger.warn('auth.no_token_cookie', {
      requestId: req.requestId,
      isBeta,
      host: req.get('host') || null,
      origin: req.get('origin') || null,
      forwardedHost: req.get('x-forwarded-host') || null,
      forwardedProto: req.get('x-forwarded-proto') || null,
      forwardedPort: req.get('x-forwarded-port') || null,
      cookieKeys,
    });
    return res.status(401).json({
      errorCode: 'UNAUTHORIZED',
      error: 'Unauthorized',
      message: 'No auth token found',
      requestId: req.requestId,
    });
  }

  try {
    const decoded = verifyJwtWithRotation<{
      userId: string;
      role: string;
      channelId?: string;
    }>(token, 'auth');
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    req.channelId = decoded.channelId;
    const ctx = getRequestContext();
    if (ctx) {
      ctx.userId = decoded.userId;
      ctx.channelId = decoded.channelId ?? null;
    }
    logger.debug('auth.success', { requestId: req.requestId, userId: decoded.userId, role: decoded.role });

    if (shouldDebugThisRoute) {
      logger.info('auth.debug', {
        stage: 'success',
        requestId: req.requestId,
        path: originalUrl,
        host: req.get('host') || null,
        forwardedProto: req.get('x-forwarded-proto') || null,
        hasCookie,
        sessionId,
        userId: req.userId || null,
        isBeta,
        instancePort: process.env.PORT || null,
      });
    }

    next();
  } catch (error) {
    // Distinguish session expiry from other invalid token reasons for UX.
    const name = (error as { name?: string })?.name;
    const isExpired = name === 'TokenExpiredError';
    if (shouldDebugThisRoute) {
      logger.info('auth.debug', {
        stage: 'jwt_invalid',
        requestId: req.requestId,
        path: originalUrl,
        host: req.get('host') || null,
        forwardedProto: req.get('x-forwarded-proto') || null,
        hasCookie,
        sessionId,
        userId: req.userId || null,
        isBeta,
        instancePort: process.env.PORT || null,
        reason: name || null,
      });
    }
    logger.warn('auth.jwt_invalid', {
      requestId: req.requestId,
      isBeta,
      host: req.get('host') || null,
      origin: req.get('origin') || null,
      forwardedHost: req.get('x-forwarded-host') || null,
      forwardedProto: req.get('x-forwarded-proto') || null,
      forwardedPort: req.get('x-forwarded-port') || null,
      reason: name || null,
    });
    return res.status(401).json({
      errorCode: isExpired ? 'SESSION_EXPIRED' : 'UNAUTHORIZED',
      error: isExpired ? 'Session expired' : 'Unauthorized',
      message: isExpired ? 'Session expired' : 'Invalid token',
      requestId: req.requestId,
    });
  }
}

// Optional auth: if cookie is present and valid, populate req.userId/userRole/channelId.
// If missing/invalid, continue as anonymous (used for public endpoints with user-specific enhancements).
export function optionalAuthenticate(req: AuthRequest, _res: Response, next: NextFunction) {
  const isBeta = isBetaDomain(req);
  const cookieToken = isBeta ? (req.cookies?.token_beta ?? req.cookies?.token) : req.cookies?.token;
  const authHeader = String(req.get('authorization') || '').trim();
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice('bearer '.length).trim() : '';
  const token = cookieToken || bearerToken;
  if (!token) return next();
  try {
    const decoded = verifyJwtWithRotation<{
      userId: string;
      role: string;
      channelId?: string;
    }>(token, 'auth_optional');
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    req.channelId = decoded.channelId;
    const ctx = getRequestContext();
    if (ctx) {
      ctx.userId = decoded.userId;
      ctx.channelId = decoded.channelId ?? null;
    }
  } catch {
    // ignore invalid token on public endpoint
  }
  return next();
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      return res.status(403).json({
        errorCode: 'ROLE_REQUIRED',
        error: 'Forbidden',
        details: { requiredRoles: roles, role: req.userRole ?? null },
        requestId: req.requestId,
      });
    }
    next();
  };
}
