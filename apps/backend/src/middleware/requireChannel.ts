import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';

export function requireChannel(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }
  next();
}


