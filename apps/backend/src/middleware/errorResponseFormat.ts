import type { NextFunction, Request, Response } from 'express';
import { ERROR_MESSAGES, defaultErrorCodeForStatus, isErrorCode, type ApiErrorResponse, type ErrorCode } from '../shared/errors.js';

function pickErrorCode(status: number, body: any): ErrorCode {
  // Prefer explicit errorCode
  if (body && isErrorCode(body.errorCode)) return body.errorCode;

  // Back-compat: some endpoints use error as a code-like string (e.g. "ALREADY_IN_CHANNEL")
  if (body && isErrorCode(body.error)) return body.error;

  return defaultErrorCodeForStatus(status);
}

function pickErrorMessage(code: ErrorCode, body: any): string {
  // Prefer explicit human message if provided
  const human =
    body && typeof body.error === 'string' && !isErrorCode(body.error)
      ? body.error
      : body && typeof body.message === 'string'
        ? body.message
        : null;
  return human && human.trim().length > 0 ? human : (ERROR_MESSAGES[code] ?? 'Error');
}

export function errorResponseFormat(req: Request, res: Response, next: NextFunction) {
  const anyReq = req as any;
  const requestId = typeof anyReq.requestId === 'string' ? anyReq.requestId : undefined;

  const originalJson = res.json.bind(res);

  res.json = ((body: any) => {
    // Only normalize error responses.
    const status = res.statusCode;
    if (status < 400) return originalJson(body);

    const code = pickErrorCode(status, body);
    const error = pickErrorMessage(code, body);
    const details = body && typeof body === 'object' && 'details' in body ? (body as any).details : undefined;

    const payload: ApiErrorResponse = { errorCode: code, error, requestId, ...(details !== undefined ? { details } : {}) };
    return originalJson(payload);
  }) as any;

  next();
}


