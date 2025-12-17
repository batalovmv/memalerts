import { prisma } from '../lib/prisma.js';
import { Request } from 'express';

export interface AuditLogData {
  action: string;
  actorId?: string | null;
  channelId?: string;
  payload?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  success?: boolean;
  error?: string;
}

/**
 * Structured logging for critical security and business actions
 * Logs to both database (AuditLog) and console (structured JSON)
 */
export async function auditLog(data: AuditLogData): Promise<void> {
  const {
    action,
    actorId,
    channelId,
    payload = {},
    ipAddress,
    userAgent,
    success = true,
    error,
  } = data;

  // Prepare structured log entry
  const logEntry = {
    timestamp: new Date().toISOString(),
    action,
    actorId: actorId || null,
    channelId: channelId || null,
    payload,
    ipAddress: ipAddress || null,
    userAgent: userAgent || null,
    success,
    error: error || null,
  };

  // Log to console in structured JSON format (for log aggregation tools)
  if (success) {
    console.log('[AUDIT]', JSON.stringify(logEntry));
  } else {
    console.error('[AUDIT_ERROR]', JSON.stringify(logEntry));
  }

  // Save to database if channelId is provided
  // Skip database logging if channelId is missing (e.g., auth actions before channel is known)
  if (channelId) {
    try {
      await prisma.auditLog.create({
        data: {
          actorId: actorId || null,
          channelId,
          action,
          payloadJson: JSON.stringify(payload),
        },
      });
    } catch (dbError: any) {
      // Don't fail the request if audit logging fails
      // But log the error for monitoring
      console.error('[AUDIT_DB_ERROR]', JSON.stringify({
        timestamp: new Date().toISOString(),
        error: 'Failed to save audit log to database',
        dbError: dbError.message,
        action,
        channelId,
      }));
    }
  }
}

/**
 * Extract request metadata for audit logging
 */
export function getRequestMetadata(req: Request): {
  ipAddress: string;
  userAgent: string;
} {
  // Get IP address (respecting proxy headers)
  const ipAddress =
    (req.headers['cf-connecting-ip'] as string) ||
    (req.headers['x-real-ip'] as string) ||
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    req.ip ||
    'unknown';

  const userAgent = (req.headers['user-agent'] as string) || 'unknown';

  return { ipAddress, userAgent };
}

/**
 * Log authentication events
 */
export async function logAuthEvent(
  action: 'login' | 'logout' | 'login_failed' | 'token_refresh',
  userId: string | null,
  success: boolean,
  req: Request,
  error?: string
): Promise<void> {
  const { ipAddress, userAgent } = getRequestMetadata(req);
  
  await auditLog({
    action: `auth.${action}`,
    actorId: userId,
    channelId: undefined, // Auth events don't have channelId
    payload: {
      action,
      success,
      ...(error && { error }),
    },
    ipAddress,
    userAgent,
    success,
    error,
  });
}

/**
 * Log file upload events
 */
export async function logFileUpload(
  userId: string,
  channelId: string,
  fileName: string,
  fileSize: number,
  success: boolean,
  req: Request,
  error?: string
): Promise<void> {
  const { ipAddress, userAgent } = getRequestMetadata(req);
  
  await auditLog({
    action: 'file.upload',
    actorId: userId,
    channelId,
    payload: {
      fileName,
      fileSize,
      success,
      ...(error && { error }),
    },
    ipAddress,
    userAgent,
    success,
    error,
  });
}

/**
 * Log admin actions (approve, reject, update, delete)
 */
export async function logAdminAction(
  action: 'approve_submission' | 'reject_submission' | 'update_meme' | 'delete_meme' | 'update_channel_settings' | 'adjust_wallet' | 'create_promotion' | 'update_promotion' | 'delete_promotion',
  userId: string,
  channelId: string,
  targetId: string,
  payload: Record<string, any>,
  success: boolean,
  req: Request,
  error?: string
): Promise<void> {
  const { ipAddress, userAgent } = getRequestMetadata(req);
  
  await auditLog({
    action: `admin.${action}`,
    actorId: userId,
    channelId,
    payload: {
      targetId,
      ...payload,
      success,
      ...(error && { error }),
    },
    ipAddress,
    userAgent,
    success,
    error,
  });
}

/**
 * Log meme activation events
 */
export async function logMemeActivation(
  userId: string,
  channelId: string,
  memeId: string,
  priceCoins: number,
  success: boolean,
  req: Request,
  error?: string
): Promise<void> {
  const { ipAddress, userAgent } = getRequestMetadata(req);
  
  await auditLog({
    action: 'meme.activate',
    actorId: userId,
    channelId,
    payload: {
      memeId,
      priceCoins,
      success,
      ...(error && { error }),
    },
    ipAddress,
    userAgent,
    success,
    error,
  });
}

/**
 * Log security events (CSRF blocked, rate limit exceeded, etc.)
 */
export async function logSecurityEvent(
  event: 'csrf_blocked' | 'rate_limit_exceeded' | 'unauthorized_access' | 'path_traversal_attempt' | 'invalid_file_type' | 'file_validation_failed',
  userId: string | null,
  channelId: string | null,
  details: Record<string, any>,
  req: Request
): Promise<void> {
  const { ipAddress, userAgent } = getRequestMetadata(req);
  
  await auditLog({
    action: `security.${event}`,
    actorId: userId,
    channelId: channelId || undefined,
    payload: details,
    ipAddress,
    userAgent,
    success: false, // Security events are always failures
  });
}

