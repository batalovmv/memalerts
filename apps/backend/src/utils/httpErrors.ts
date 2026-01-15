type ErrorLike = {
  status?: number;
  statusCode?: number;
  response?: { status?: number };
  code?: string;
  name?: string;
  message?: string;
};

export function extractHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const err = error as ErrorLike;
  const status =
    (typeof err.status === 'number' ? err.status : undefined) ??
    (typeof err.statusCode === 'number' ? err.statusCode : undefined) ??
    (typeof err.response?.status === 'number' ? err.response.status : undefined);
  if (!Number.isFinite(status)) return null;
  return Math.floor(status!);
}

export function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as ErrorLike;
  if (err.name === 'AbortError') return true;
  const msg = String(err.message || '').toLowerCase();
  if (msg.includes('timeout')) return true;
  if (msg.includes('timed out')) return true;
  if (msg.includes('aborted')) return true;
  const code = String(err.code || '').toUpperCase();
  return code === 'ETIMEDOUT';
}

export function isTransientHttpError(error: unknown): boolean {
  if (isTimeoutError(error)) return true;
  const status = extractHttpStatus(error);
  if (status == null) return true;
  return status === 408 || status === 429 || status >= 500;
}
