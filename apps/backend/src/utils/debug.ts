/**
 * Debug logging helper.
 *
 * IMPORTANT:
 * - Debug logs must be opt-in via env to avoid leaking noisy/PII logs on production.
 * - Keep payloads minimal; never log secrets/tokens.
 */
export function isDebugLogsEnabled(): boolean {
  const v = String(process.env.DEBUG_LOGS ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function debugLog(message: string, data?: unknown) {
  if (!isDebugLogsEnabled()) return;
  if (typeof data === 'undefined') {
    // eslint-disable-next-line no-console
    console.log(message);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(message, data);
}

export function debugError(message: string, error: unknown) {
  if (!isDebugLogsEnabled()) return;
  // eslint-disable-next-line no-console
  console.error(message, sanitizeError(error));
}

export function sanitizeError(error: unknown) {
  if (!error || typeof error !== 'object') return error;
  const anyErr = error as any;
  return {
    name: anyErr.name,
    message: anyErr.message,
    code: anyErr.code,
  };
}



