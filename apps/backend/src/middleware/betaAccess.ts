import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { prisma } from '../lib/prisma.js';
import fs from 'fs';
import path from 'path';

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
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'betaAccess.ts:35',message:'Beta access cache invalidated',data:{userId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
}

// Check if request is for beta domain
export function isBetaDomain(req: Request): boolean {
  const host = req.get('host') || '';
  const domain = process.env.DOMAIN || '';
  return host.includes('beta.') || domain.includes('beta.');
}

export async function requireBetaAccess(req: AuthRequest, res: Response, next: NextFunction) {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'betaAccess.ts:42',message:'requireBetaAccess called',data:{path:req.path,userId:req.userId,host:req.get('host'),domain:process.env.DOMAIN},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  
  // Only check beta access if this is a beta domain request
  const isBeta = isBetaDomain(req);
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'betaAccess.ts:46',message:'Beta domain check result',data:{isBeta,host:req.get('host'),domain:process.env.DOMAIN},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  
  if (!isBeta) {
    return next();
  }

  // For public routes (like /channels/:slug), allow access without authentication
  const isPublicRoute = req.path.startsWith('/channels/memes/search') ||
                        req.path === '/memes/stats' ||
                        /^\/channels\/[^\/]+$/.test(req.path); // Match /channels/:slug (public route)

  if (isPublicRoute) {
    return next();
  }

  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
  }

  try {
    // Check cache first to reduce database load
    const cachedAccess = getCachedBetaAccess(req.userId);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'betaAccess.ts:64',message:'Cache check result',data:{userId:req.userId,cachedAccess},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    
    if (cachedAccess !== null) {
      if (!cachedAccess) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'betaAccess.ts:68',message:'Access denied from cache',data:{userId:req.userId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        return res.status(403).json({ 
          error: 'Forbidden', 
          message: 'Beta access required. Please request access or contact an administrator.' 
        });
      }
      // User has beta access (from cache), continue
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'betaAccess.ts:75',message:'Access granted from cache',data:{userId:req.userId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
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
    
    // #region agent log
    try{const logData={location:'betaAccess.ts:112',message:'Database check result',data:{userId:req.userId,hasAccess,hasBetaAccess:user?.hasBetaAccess,isBetaBackend},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'};fs.appendFileSync(path.join(process.cwd(),'.cursor','debug.log'),JSON.stringify(logData)+'\n');}catch(e){}
    // #endregion
    
    // Cache the result
    setCachedBetaAccess(req.userId, hasAccess);

    // If user doesn't have beta access, deny access
    if (!hasAccess) {
      console.log('[requireBetaAccess] User does not have beta access:', req.userId);
      // #region agent log
      try{const logData={location:'betaAccess.ts:123',message:'Access denied from database',data:{userId:req.userId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'};fs.appendFileSync(path.join(process.cwd(),'.cursor','debug.log'),JSON.stringify(logData)+'\n');}catch(e){}
      // #endregion
      return res.status(403).json({ 
        error: 'Forbidden', 
        message: 'Beta access required. Please request access or contact an administrator.' 
      });
    }

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'betaAccess.ts:101',message:'Access granted from database',data:{userId:req.userId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    next();
  } catch (error) {
    console.error('Error checking beta access:', error);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'betaAccess.ts:105',message:'Error checking beta access',data:{userId:req.userId,error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    return res.status(500).json({ error: 'Internal server error' });
  }
}

