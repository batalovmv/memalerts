import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  channelId?: string;
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.cookies.token;

  console.log('Authenticate middleware called:', {
    path: req.path,
    method: req.method,
    cookies: req.cookies,
    cookieHeader: req.headers.cookie,
    origin: req.headers.origin,
    referer: req.headers.referer,
  });

  if (!token) {
    console.log('No token cookie found. Cookies:', req.cookies);
    console.log('Request headers:', {
      cookie: req.headers.cookie,
      origin: req.headers.origin,
      referer: req.headers.referer,
    });
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


