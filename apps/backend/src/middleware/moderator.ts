import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth.js';
import { prisma } from '../lib/prisma.js';

/**
 * Global moderator permission.
 *
 * IMPORTANT:
 * - This does NOT rely on User.role. Admin is always allowed.
 * - This checks DB for an active GlobalModerator grant (revokedAt IS NULL).
 * - Intended for low-traffic moderator/admin panels (not hot public paths).
 */
export function requireGlobalModerator() {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userId) {
      return res.status(401).json({
        errorCode: 'UNAUTHORIZED',
        error: 'Unauthorized',
        requestId: req.requestId,
      });
    }

    if (req.userRole === 'admin') return next();

    try {
      const gm = await prisma.globalModerator.findUnique({
        where: { userId: req.userId },
        select: { revokedAt: true },
      });
      if (!gm || gm.revokedAt) {
        return res.status(403).json({
          errorCode: 'FORBIDDEN',
          error: 'Forbidden',
          requestId: req.requestId,
        });
      }
      return next();
    } catch {
      return res.status(500).json({
        errorCode: 'INTERNAL_ERROR',
        error: 'Internal server error',
        requestId: req.requestId,
      });
    }
  };
}


