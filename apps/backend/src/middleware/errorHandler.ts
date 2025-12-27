import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';
import { ERROR_CODES, ERROR_MESSAGES, defaultErrorCodeForStatus, type ErrorCode } from '../shared/errors.js';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  const anyReq = req as any;
  const requestId = typeof anyReq.requestId === 'string' ? anyReq.requestId : undefined;
  const userId = typeof anyReq.userId === 'string' ? anyReq.userId : null;
  const channelId = typeof anyReq.channelId === 'string' ? anyReq.channelId : null;

  logger.error('http.error', {
    requestId,
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
    });
  };

  if (err instanceof ZodError) {
    return send(400, ERROR_CODES.VALIDATION_ERROR);
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

  // Handle multer errors
  if ((err as any).code === 'LIMIT_FILE_SIZE') {
    return send(413, ERROR_CODES.FILE_TOO_LARGE);
  }

  if ((err as any).code === 'LIMIT_UNEXPECTED_FILE') {
    return send(400, ERROR_CODES.BAD_REQUEST, 'Unexpected file field');
  }

  if ((err as any).code === 'LIMIT_PART_COUNT' || (err as any).code === 'LIMIT_FILE_COUNT') {
    return send(400, ERROR_CODES.BAD_REQUEST, 'Too many files');
  }

  // Handle timeout errors
  if (err.message?.includes('timeout') || err.message === 'Submission creation timeout') {
    return send(408, ERROR_CODES.TIMEOUT);
  }

  // Handle ECONNRESET and other connection errors
  if ((err as any).code === 'ECONNRESET' || (err as any).code === 'ECONNABORTED') {
    return send(408, ERROR_CODES.TIMEOUT, 'Connection was reset or aborted');
  }

  // In production, never expose error details to prevent information leakage
  const isProduction = process.env.NODE_ENV === 'production';
  const fallbackStatus = 500;
  const fallbackCode = defaultErrorCodeForStatus(fallbackStatus);
  const msg = isProduction ? undefined : err.message;
  return send(fallbackStatus, fallbackCode, msg ?? ERROR_MESSAGES[fallbackCode]);
}


