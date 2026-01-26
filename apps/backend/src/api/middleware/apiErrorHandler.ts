import type { Request, Response, NextFunction } from 'express';
import type { ErrorResponse } from '@memalerts/api-contracts';
import { ZodError } from 'zod';
import { AppError } from '../../shared/errors.js';

export function apiErrorHandler(err: Error, _req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof AppError) {
    const response: ErrorResponse = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    };
    return res.status(err.status).json(response);
  }

  if (err instanceof ZodError) {
    const response: ErrorResponse = {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: {
          issues: err.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
    };
    return res.status(400).json(response);
  }

  const response: ErrorResponse = {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  };
  return res.status(500).json(response);
}
