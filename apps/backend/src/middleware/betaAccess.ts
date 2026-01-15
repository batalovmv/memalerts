import type { Request, Response, NextFunction } from 'express';
import type { AuthRequest } from './auth.js';
import { prisma } from '../lib/prisma.js';
import { debugLog, debugError } from '../utils/debug.js';

// Simple in-memory cache for beta access checks (5 minute TTL)
// This reduces database load for frequent beta access checks
interface CacheEntry {
  hasAccess: boolean;
  timestamp: number;
}

const betaAccessCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 50_000;

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
  if (betaAccessCache.size > CACHE_MAX_SIZE) {
    // Simple protection against unbounded memory growth on abusive traffic.
    betaAccessCache.clear();
  }
}

// Export function to invalidate cache (used after granting beta access)
export function invalidateBetaAccessCache(userId: string): void {
  betaAccessCache.delete(userId);
}

// Check if request is for beta domain
export function isBetaDomain(req: Request): boolean {
  const forwardedHost = (req.get('x-forwarded-host') || '').split(',')[0]?.trim() || '';
  const host = (req.get('host') || '').split(',')[0]?.trim() || '';
  const domain = process.env.DOMAIN || '';
  return forwardedHost.includes('beta.') || host.includes('beta.') || domain.includes('beta.');
}

export async function requireBetaAccess(req: AuthRequest, res: Response, next: NextFunction) {
  // Only check beta access if this is a beta domain request
  const isBeta = isBetaDomain(req);

  if (!isBeta) {
    return next();
  }

  // Allow authenticated users to load their session/profile and request beta access.
  // On beta, everything else is blocked until access is granted.
  // IMPORTANT: /auth/* must remain accessible on beta for login/link flows.
  if (req.path === '/me' || req.path.startsWith('/beta/') || req.path.startsWith('/auth/')) {
    return next();
  }

  // Optional: allow health checks without beta access
  if (req.path === '/health') {
    return next();
  }

  if (!req.userId) {
    return res
      .status(401)
      .json({ errorCode: 'UNAUTHORIZED', error: 'Unauthorized', message: 'Authentication required' });
  }

  try {
    // Check cache first to reduce database load
    const cachedAccess = getCachedBetaAccess(req.userId);

    if (cachedAccess !== null) {
      if (!cachedAccess) {
        return res.status(403).json({
          errorCode: 'BETA_ACCESS_REQUIRED',
          error: 'Beta access required',
          message: 'Beta access required. Please request access or contact an administrator.',
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

    // Cache the result
    setCachedBetaAccess(req.userId, hasAccess);

    // If user doesn't have beta access, deny access
    if (!hasAccess) {
      debugLog('[requireBetaAccess] User does not have beta access', { userId: req.userId });
      return res.status(403).json({
        errorCode: 'BETA_ACCESS_REQUIRED',
        error: 'Beta access required',
        message: 'Beta access required. Please request access or contact an administrator.',
      });
    }

    next();
  } catch (error) {
    debugError('Error checking beta access', error);
    return res.status(500).json({ errorCode: 'INTERNAL_ERROR', error: 'Internal server error' });
  }
}

/**
 * Beta gating helper for "public read" endpoints.
 *
 * Semantics:
 * - production: always pass-through
 * - beta:
 *   - guest (no session): 403 BETA_ACCESS_REQUIRED (so frontend can show "beta required" screen)
 *   - authenticated: defer to requireBetaAccess (may 403 if user has no access)
 */
export async function requireBetaAccessOrGuestForbidden(req: AuthRequest, res: Response, next: NextFunction) {
  if (!isBetaDomain(req)) return next();
  if (!req.userId) {
    return res.status(403).json({
      errorCode: 'BETA_ACCESS_REQUIRED',
      error: 'Beta access required',
      message: 'Beta access required. Please request access or contact an administrator.',
    });
  }
  return requireBetaAccess(req, res, next);
}
