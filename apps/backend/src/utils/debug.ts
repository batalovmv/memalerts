/**
 * Debug logging helper.
 *
 * IMPORTANT:
 * - Debug logs must be opt-in via env to avoid leaking noisy/PII logs on production.
 * - Keep payloads minimal; never log secrets/tokens.
 */
import { logger } from './logger.js';

export function isDebugLogsEnabled(): boolean {
  const v = String(process.env.DEBUG_LOGS ?? '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Temporary auth debugging toggle.
 *
 * - Opt-in via env only (never via query params/headers).
 * - DEBUG_AUTH=1 enables, or DEBUG_LOGS=1 also enables (convenience).
 */
export function isDebugAuthEnabled(): boolean {
  if (isDebugLogsEnabled()) return true;
  const v = String(process.env.DEBUG_AUTH ?? '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function debugLog(message: string, data?: unknown) {
  if (!isDebugLogsEnabled()) return;
  if (typeof data === 'undefined') {
    logger.debug(message);
    return;
  }
  if (data && typeof data === 'object') {
    logger.debug(message, data as Record<string, unknown>);
  } else {
    logger.debug(message, { data });
  }
}

export function debugError(message: string, error: unknown) {
  if (!isDebugLogsEnabled()) return;
  logger.error(message, { error: sanitizeError(error) });
}

export function sanitizeError(error: unknown) {
  if (!error || typeof error !== 'object') return error;
  const errInfo = error as { name?: string; message?: string; code?: string };
  return {
    name: errInfo.name,
    message: errInfo.message,
    code: errInfo.code,
  };
}
