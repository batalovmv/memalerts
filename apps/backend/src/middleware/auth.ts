import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  channelId?: string;
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.cookies.token;

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'middleware/auth.ts:authenticate', message: 'Authenticate middleware called', data: { path: req.path, method: req.method, originalUrl: req.originalUrl, baseUrl: req.baseUrl, hasToken: !!token, cookieHeader: req.headers.cookie }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => {});
  // #endregion

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'middleware/auth.ts:authenticate', message: 'Full request details', data: { path: req.path, method: req.method, cookies: Object.keys(req.cookies || {}), cookieHeader: req.headers.cookie, allHeaders: Object.keys(req.headers), origin: req.headers.origin, referer: req.headers.referer }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run3', hypothesisId: 'D' }) }).catch(() => {});
  // #endregion

  console.log('Authenticate middleware called:', {
    path: req.path,
    method: req.method,
    cookies: req.cookies,
    cookieHeader: req.headers.cookie,
    origin: req.headers.origin,
    referer: req.headers.referer,
    allHeaders: Object.keys(req.headers),
  });

  if (!token) {
    console.log('No token cookie found. Cookies:', req.cookies);
    console.log('Request headers:', {
      cookie: req.headers.cookie,
      origin: req.headers.origin,
      referer: req.headers.referer,
      allHeaders: Object.keys(req.headers),
    });
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'middleware/auth.ts:authenticate', message: 'No token found - detailed headers', data: { cookieHeader: req.headers.cookie, cookieHeaderLength: req.headers.cookie?.length || 0, allCookieHeaders: req.headers['cookie'], cookiesObject: req.cookies, cookiesKeys: Object.keys(req.cookies || {}) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run3', hypothesisId: 'D' }) }).catch(() => {});
    // #endregion
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
    console.log('Authentication successful:', { userId: decoded.userId, role: decoded.role });
    next();
  } catch (error) {
    console.error('JWT verification failed:', error);
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid token' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}


