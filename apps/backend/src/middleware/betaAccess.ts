import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { prisma } from '../lib/prisma.js';

// Check if request is for beta domain
export function isBetaDomain(req: Request): boolean {
  const host = req.get('host') || '';
  const domain = process.env.DOMAIN || '';
  return host.includes('beta.') || domain.includes('beta.');
}

export async function requireBetaAccess(req: AuthRequest, res: Response, next: NextFunction) {
  // Only check beta access if this is a beta domain request
  if (!isBetaDomain(req)) {
    return next();
  }

  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
  }

  try {
    // Check if user has beta access
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { hasBetaAccess: true },
    });

    if (!user || !user.hasBetaAccess) {
      // Check if user has a pending request
      const betaAccess = await prisma.betaAccess.findUnique({
        where: { userId: req.userId },
        select: { status: true },
      });

      if (betaAccess?.status === 'pending') {
        return res.status(403).json({
          error: 'Beta Access Pending',
          message: 'Your beta access request is pending approval. Please wait for admin approval.',
          status: 'pending',
        });
      }

      if (betaAccess?.status === 'rejected') {
        return res.status(403).json({
          error: 'Beta Access Denied',
          message: 'Your beta access request was rejected. Please contact an administrator.',
          status: 'rejected',
        });
      }

      return res.status(403).json({
        error: 'Beta Access Required',
        message: 'You do not have access to the beta version. Please request access first.',
        status: 'no_access',
      });
    }

    next();
  } catch (error) {
    console.error('Error checking beta access:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

