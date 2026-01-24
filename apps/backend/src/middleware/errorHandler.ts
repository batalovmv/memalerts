import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';
import { CircuitBreakerOpenError } from '../utils/circuitBreaker.js';
import { ERROR_CODES, ERROR_MESSAGES, defaultErrorCodeForStatus, type ErrorCode } from '../shared/errors.js';
import { ApiError } from '../shared/apiError.js';
import type { AuthRequest } from './auth.js';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  const authReq = req as AuthRequest;
  const requestId = typeof authReq.requestId === 'string' ? authReq.requestId : undefined;
  const traceId = typeof authReq.traceId === 'string' ? authReq.traceId : undefined;
  const userId = typeof authReq.userId === 'string' ? authReq.userId : null;
  const channelId = typeof authReq.channelId === 'string' ? authReq.channelId : null;
  const errWithCode = err as Error & { code?: string };

  logger.error('http.error', {
    requestId,
    traceId,
    method: req.method,
    path: req.path,
    userId,
    channelId,
    errorName: err?.name,
    errorMessage: err?.message,
    // Stack can contain sensitive paths; keep it only outside production.
    ...(process.env.NODE_ENV === 'production' ? {} : { stack: err?.stack }),
  });

  // Don't send response if headers already sent
  if (res.headersSent) {
    logger.warn('http.error.headersSent', { requestId, method: req.method, path: req.path });
    return next(err);
  }

  const send = (status: number, errorCode: ErrorCode, error?: string) => {
    // NOTE: errorResponseFormat middleware will also normalize, but we keep this explicit here
    // so the error handler is self-contained.
    return res.status(status).json({
      errorCode,
      error: error ?? ERROR_MESSAGES[errorCode] ?? 'Error',
      requestId,
      traceId,
    });
  };

  if (err instanceof ApiError) {
    const errorMsg = err.message && err.message !== err.errorCode ? err.message : undefined;
    const details =
      err.details !== undefined ? (Array.isArray(err.details) ? err.details : [err.details]) : undefined;
    return res.status(err.status).json({
      errorCode: err.errorCode,
      error: errorMsg ?? ERROR_MESSAGES[err.errorCode] ?? 'Error',
      requestId,
      traceId,
      ...(details !== undefined ? { details } : {}),
    });
  }

  if (err instanceof ZodError) {
    logger.warn('http.validation_failed', {
      requestId,
      traceId,
      method: req.method,
      path: req.path,
      issues: err.issues,
    });
    return res.status(400).json({
      errorCode: ERROR_CODES.VALIDATION_ERROR,
      error: ERROR_MESSAGES[ERROR_CODES.VALIDATION_ERROR] ?? 'Validation failed',
      requestId,
      traceId,
      details: err.issues,
    });
  }

  if (err.name === 'UnauthorizedError' || err.message === 'Unauthorized') {
    return send(401, ERROR_CODES.UNAUTHORIZED);
  }

  if (err.message === 'Forbidden') {
    return send(403, ERROR_CODES.FORBIDDEN);
  }

  if (err.message === 'Not Found') {
    return send(404, ERROR_CODES.NOT_FOUND);
  }

  if (err instanceof CircuitBreakerOpenError) {
    return send(503, ERROR_CODES.RELAY_UNAVAILABLE);
  }

  // Handle multer errors
  if (errWithCode.code === 'LIMIT_FILE_SIZE') {
    return send(413, ERROR_CODES.FILE_TOO_LARGE);
  }

  if (errWithCode.code === 'LIMIT_UNEXPECTED_FILE') {
    return send(400, ERROR_CODES.BAD_REQUEST, 'Unexpected file field');
  }

  if (errWithCode.code === 'LIMIT_PART_COUNT' || errWithCode.code === 'LIMIT_FILE_COUNT') {
    return send(400, ERROR_CODES.BAD_REQUEST, 'Too many files');
  }

  // Handle timeout errors
  if (err.message?.includes('timeout') || err.message === 'Submission creation timeout') {
    return send(408, ERROR_CODES.TIMEOUT);
  }

  // Handle ECONNRESET and other connection errors
  if (errWithCode.code === 'ECONNRESET' || errWithCode.code === 'ECONNABORTED') {
    return send(408, ERROR_CODES.TIMEOUT, 'Connection was reset or aborted');
  }

  // In production, never expose error details to prevent information leakage
  const isProduction = process.env.NODE_ENV === 'production';
  const fallbackStatus = 500;
  const fallbackCode = defaultErrorCodeForStatus(fallbackStatus);
  const msg = isProduction ? undefined : err.message;
  return send(fallbackStatus, fallbackCode, msg ?? ERROR_MESSAGES[fallbackCode]);
}
