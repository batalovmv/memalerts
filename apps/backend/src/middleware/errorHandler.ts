import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';

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

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation error',
      message: 'Validation failed',
      details: err.errors,
      requestId,
    });
  }

  if (err.name === 'UnauthorizedError' || err.message === 'Unauthorized') {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Unauthorized',
      requestId,
    });
  }

  if (err.message === 'Forbidden') {
    return res.status(403).json({ 
      error: 'Forbidden',
      message: 'Forbidden',
      requestId,
    });
  }

  if (err.message === 'Not Found') {
    return res.status(404).json({ 
      error: 'Not Found',
      message: 'Not Found',
      requestId,
    });
  }

  // Handle multer errors
  if ((err as any).code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error: 'File too large',
      message: 'File size exceeds maximum allowed size',
      requestId,
    });
  }

  if ((err as any).code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      error: 'Unexpected file field',
      message: 'Unexpected file field name',
      requestId,
    });
  }

  if ((err as any).code === 'LIMIT_PART_COUNT' || (err as any).code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({
      error: 'Too many files',
      message: 'Too many files in request',
      requestId,
    });
  }

  // Handle timeout errors
  if (err.message?.includes('timeout') || err.message === 'Submission creation timeout') {
    return res.status(408).json({
      error: 'Request timeout',
      message: 'Request timed out. Please try again.',
      requestId,
    });
  }

  // Handle ECONNRESET and other connection errors
  if ((err as any).code === 'ECONNRESET' || (err as any).code === 'ECONNABORTED') {
    return res.status(408).json({
      error: 'Connection error',
      message: 'Connection was reset or aborted. Please try again.',
      requestId,
    });
  }

  // In production, never expose error details to prevent information leakage
  const isProduction = process.env.NODE_ENV === 'production';
  
  res.status(500).json({
    error: 'Internal server error',
    message: 'Internal server error',
    requestId,
    // Only include details in development
    ...(isProduction ? {} : { 
      details: err.message,
      stack: err.stack 
    }),
  });
}


