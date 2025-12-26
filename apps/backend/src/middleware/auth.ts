import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  channelId?: string;
  requestId?: string;
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

  if (!token) {
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
      error: 'Unauthorized',
      message: 'No auth token found',
      requestId: req.requestId,
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string;
      role: string;
      channelId?: string;
    };
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    req.channelId = decoded.channelId;
    logger.debug('auth.success', { requestId: req.requestId, userId: decoded.userId, role: decoded.role });
    
    next();
  } catch (error) {
    logger.warn('auth.jwt_invalid', {
      requestId: req.requestId,
      isBeta,
      host: req.get('host') || null,
      origin: req.get('origin') || null,
      forwardedHost: req.get('x-forwarded-host') || null,
      forwardedProto: req.get('x-forwarded-proto') || null,
      forwardedPort: req.get('x-forwarded-port') || null,
    });
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid token',
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string;
      role: string;
      channelId?: string;
    };
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    req.channelId = decoded.channelId;
  } catch {
    // ignore invalid token on public endpoint
  }
  return next();
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Forbidden',
        requestId: req.requestId,
      });
    }
    next();
  };
}


