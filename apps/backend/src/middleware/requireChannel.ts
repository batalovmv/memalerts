import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth.js';

export function requireChannel(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.channelId) {
    return res
      .status(400)
      .json({ errorCode: 'BAD_REQUEST', error: 'Channel ID required', details: { field: 'channelId' } });
  }
  next();
}
