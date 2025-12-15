import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error('Error:', err);

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation error',
      details: err.errors,
    });
  }

  if (err.name === 'UnauthorizedError' || err.message === 'Unauthorized') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (err.message === 'Forbidden') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (err.message === 'Not Found') {
    return res.status(404).json({ error: 'Not Found' });
  }

  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
}


