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

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'betaAccess.ts:requireBetaAccess',message:'Checking beta access',data:{userId:req.userId,hasBetaAccess:user?.hasBetaAccess,userExists:!!user},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion

    // If user doesn't have beta access, grant it automatically
    // This ensures all users can access beta (accounts are shared between beta and production)
    if (!user || !user.hasBetaAccess) {
      console.log('[requireBetaAccess] User does not have beta access, granting automatically:', req.userId);
      await prisma.user.update({
        where: { id: req.userId },
        data: { hasBetaAccess: true },
      });
      // Continue to next middleware
      return next();
    }

    // User has beta access, continue
    next();
  } catch (error) {
    console.error('Error checking beta access:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

