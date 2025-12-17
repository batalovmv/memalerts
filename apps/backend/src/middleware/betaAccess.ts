import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { prisma } from '../lib/prisma.js';

// Simple in-memory cache for beta access checks (5 minute TTL)
// This reduces database load for frequent beta access checks
interface CacheEntry {
  hasAccess: boolean;
  timestamp: number;
}

const betaAccessCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedBetaAccess(userId: string): boolean | null {
  const entry = betaAccessCache.get(userId);
  if (!entry) return null;
  
  const age = Date.now() - entry.timestamp;
  if (age > CACHE_TTL_MS) {
    betaAccessCache.delete(userId);
    return null;
  }
  
  return entry.hasAccess;
}

function setCachedBetaAccess(userId: string, hasAccess: boolean): void {
  betaAccessCache.set(userId, {
    hasAccess,
    timestamp: Date.now(),
  });
}

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

<<<<<<< Updated upstream
=======
  // For public routes (like /channels/:slug), allow access without authentication
  // These routes are excluded from requireBetaAccess in index.ts, but this is a safety check
  const isPublicRoute = req.path.startsWith('/channels/memes/search') ||
                        req.path === '/memes/stats' ||
                        /^\/channels\/[^\/]+$/.test(req.path); // Match /channels/:slug (public route)
  
  console.log('[requireBetaAccess] Checking route:', {
    path: req.path,
    isPublicRoute,
    regexTest: /^\/channels\/[^\/]+$/.test(req.path),
    hasUserId: !!req.userId,
  });
  
  if (isPublicRoute) {
    console.log('[requireBetaAccess] Public route, allowing access without authentication');
    return next();
  }

>>>>>>> Stashed changes
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
  }

  try {
    // Check cache first to reduce database load
    const cachedAccess = getCachedBetaAccess(req.userId);
    if (cachedAccess !== null) {
      if (!cachedAccess) {
        return res.status(403).json({ 
          error: 'Forbidden', 
          message: 'Beta access required. Please request access or contact an administrator.' 
        });
      }
      // User has beta access (from cache), continue
      return next();
    }

    // Cache miss - check database
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { hasBetaAccess: true },
    });

<<<<<<< Updated upstream
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
=======
    const hasAccess = user?.hasBetaAccess || false;
    
    // Cache the result
    setCachedBetaAccess(req.userId, hasAccess);

    // If user doesn't have beta access, deny access
    if (!hasAccess) {
      console.log('[requireBetaAccess] User does not have beta access:', req.userId);
      return res.status(403).json({ 
        error: 'Forbidden', 
        message: 'Beta access required. Please request access or contact an administrator.' 
>>>>>>> Stashed changes
      });
    }

    next();
  } catch (error) {
    console.error('Error checking beta access:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

