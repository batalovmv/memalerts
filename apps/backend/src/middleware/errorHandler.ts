import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error('Error:', err);

  // Don't send response if headers already sent
  if (res.headersSent) {
    console.error('Error occurred after response was sent, cannot send error response');
    return next(err);
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation error',
      message: 'Validation failed',
      details: err.errors,
    });
  }

  if (err.name === 'UnauthorizedError' || err.message === 'Unauthorized') {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Unauthorized',
    });
  }

  if (err.message === 'Forbidden') {
    return res.status(403).json({ 
      error: 'Forbidden',
      message: 'Forbidden',
    });
  }

  if (err.message === 'Not Found') {
    return res.status(404).json({ 
      error: 'Not Found',
      message: 'Not Found',
    });
  }

  // Handle multer errors
  if ((err as any).code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error: 'File too large',
      message: 'File size exceeds maximum allowed size',
    });
  }

  if ((err as any).code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      error: 'Unexpected file field',
      message: 'Unexpected file field name',
    });
  }

  if ((err as any).code === 'LIMIT_PART_COUNT' || (err as any).code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({
      error: 'Too many files',
      message: 'Too many files in request',
    });
  }

  // Handle timeout errors
  if (err.message?.includes('timeout') || err.message === 'Submission creation timeout') {
    return res.status(408).json({
      error: 'Request timeout',
      message: 'Request timed out. Please try again.',
    });
  }

  // Handle ECONNRESET and other connection errors
  if ((err as any).code === 'ECONNRESET' || (err as any).code === 'ECONNABORTED') {
    return res.status(408).json({
      error: 'Connection error',
      message: 'Connection was reset or aborted. Please try again.',
    });
  }

  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
}


