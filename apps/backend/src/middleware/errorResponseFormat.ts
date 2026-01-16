import type { NextFunction, Request, Response } from 'express';
import {
  ERROR_MESSAGES,
  defaultErrorCodeForStatus,
  isErrorCode,
  type ApiErrorResponse,
  type ErrorCode,
} from '../shared/errors.js';
import type { AuthRequest } from './auth.js';
import { getActiveTraceId } from '../tracing/traceContext.js';

function pickErrorCode(status: number, body: unknown): ErrorCode {
  // Prefer explicit errorCode
  if (body && typeof body === 'object' && isErrorCode((body as { errorCode?: unknown }).errorCode)) {
    return (body as { errorCode: ErrorCode }).errorCode;
  }

  // Back-compat: some endpoints use error as a code-like string (e.g. "ALREADY_IN_CHANNEL")
  if (body && typeof body === 'object' && isErrorCode((body as { error?: unknown }).error)) {
    return (body as { error: ErrorCode }).error;
  }

  return defaultErrorCodeForStatus(status);
}

function pickErrorMessage(code: ErrorCode, body: unknown): string {
  // Prefer explicit human message if provided.
  // IMPORTANT: Many legacy controllers/middlewares return { error: "Generic", message: "Specific reason" }.
  // errorResponseFormat historically preferred `error`, which hid the useful `message`.
  const humanMessage =
    body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
      ? (body as { message: string }).message
      : null;
  if (humanMessage && humanMessage.trim().length > 0) return humanMessage;

  const humanError =
    body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : null;
  if (humanError && humanError.trim().length > 0) return humanError;

  return ERROR_MESSAGES[code] ?? 'Error';
}

export function errorResponseFormat(req: Request, res: Response, next: NextFunction) {
  const authReq = req as AuthRequest;
  const requestId =
    typeof authReq.requestId === 'string'
      ? authReq.requestId
      : typeof (res.locals as { requestId?: unknown })?.requestId === 'string'
        ? (res.locals as { requestId: string }).requestId
        : undefined;
  const traceId =
    typeof authReq.traceId === 'string'
      ? authReq.traceId
      : ((res.locals as { traceId?: string | null })?.traceId ?? getActiveTraceId() ?? null);

  const originalJson = res.json.bind(res);

  res.json = ((body: unknown) => {
    // Only normalize error responses.
    const status = res.statusCode;
    if (status < 400) return originalJson(body);

    const code = pickErrorCode(status, body);
    const error = pickErrorMessage(code, body);
    const details =
      body && typeof body === 'object' && 'details' in body ? (body as { details?: unknown }).details : undefined;

    const payload: ApiErrorResponse = {
      errorCode: code,
      error,
      requestId,
      traceId,
      ...(details !== undefined ? { details } : {}),
    };
    return originalJson(payload);
  }) as Response['json'];

  next();
}
