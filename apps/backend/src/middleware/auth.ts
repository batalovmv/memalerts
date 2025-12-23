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
  const host = req.get('host') || '';
  const domain = process.env.DOMAIN || '';
  return host.includes('beta.') || domain.includes('beta.');
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  // IMPORTANT:
  // - Production and beta use different JWT secrets.
  // - If we reuse the same cookie name across subdomains (Domain=twitchmemes.ru),
  //   the prod cookie can be sent to beta and break auth with 401.
  // - Therefore beta uses a dedicated cookie name: token_beta.
  const isBeta = isBetaDomain(req);
  const token = isBeta ? (req.cookies?.token_beta ?? req.cookies?.token) : req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', message: 'No token cookie found' });
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
    logger.warn('auth.jwt_invalid', { requestId: req.requestId });
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid token' });
  }
}

// Optional auth: if cookie is present and valid, populate req.userId/userRole/channelId.
// If missing/invalid, continue as anonymous (used for public endpoints with user-specific enhancements).
export function optionalAuthenticate(req: AuthRequest, _res: Response, next: NextFunction) {
  const isBeta = isBetaDomain(req);
  const token = isBeta ? (req.cookies?.token_beta ?? req.cookies?.token) : req.cookies?.token;
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
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}


