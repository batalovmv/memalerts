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

// Export function to invalidate cache (used after granting beta access)
export function invalidateBetaAccessCache(userId: string): void {
  betaAccessCache.delete(userId);
}

// Check if request is for beta domain
export function isBetaDomain(req: Request): boolean {
  const host = req.get('host') || '';
  const domain = process.env.DOMAIN || '';
  return host.includes('beta.') || domain.includes('beta.');
}

export async function requireBetaAccess(req: AuthRequest, res: Response, next: NextFunction) {
  // Only check beta access if this is a beta domain request
  const isBeta = isBetaDomain(req);
  
  if (!isBeta) {
    return next();
  }

  // For public routes (like /channels/:slug), allow access without authentication
  const isPublicRoute = req.path.startsWith('/channels/memes/search') ||
                        req.path === '/memes/stats' ||
                        /^\/channels\/[^\/]+$/.test(req.path) || // Match /channels/:slug (public route)
                        /^\/channels\/[^\/]+\/memes$/.test(req.path); // Match /channels/:slug/memes (public route)

  if (isPublicRoute) {
    return next();
  }

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

    let hasAccess = user?.hasBetaAccess || false;
    
    // If this is beta backend and user doesn't have beta access, grant it automatically
    // This handles the case where user was logged in before beta access logic was added
    const isBetaBackend = process.env.DOMAIN?.includes('beta.') || process.env.PORT === '3002';
    if (isBetaBackend && !hasAccess) {
      console.log('[requireBetaAccess] Auto-granting beta access to user on beta backend:', req.userId);
      await prisma.user.update({
        where: { id: req.userId },
        data: { hasBetaAccess: true },
      });
      hasAccess = true;
      // Invalidate cache so it's updated
      invalidateBetaAccessCache(req.userId);
    }
    
    // Cache the result
    setCachedBetaAccess(req.userId, hasAccess);

    // If user doesn't have beta access, deny access
    if (!hasAccess) {
      console.log('[requireBetaAccess] User does not have beta access:', req.userId);
      return res.status(403).json({ 
        error: 'Forbidden', 
        message: 'Beta access required. Please request access or contact an administrator.' 
      });
    }

    next();
  } catch (error) {
    console.error('Error checking beta access:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

