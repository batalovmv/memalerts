import type { NextFunction, Request, Response } from 'express';
import type { AuthRequest } from './auth.js';

const DEFAULT_MAX_KEY_LENGTH = 128;

export function idempotencyKey(req: Request, res: Response, next: NextFunction) {
  const raw = req.get('Idempotency-Key');
  if (typeof raw !== 'string') return next();
  const trimmed = raw.trim();
  if (!trimmed) return next();

  const maxLenRaw = Number.parseInt(String(process.env.IDEMPOTENCY_KEY_MAX_LEN || ''), 10);
  const maxLen = Number.isFinite(maxLenRaw) && maxLenRaw > 0 ? maxLenRaw : DEFAULT_MAX_KEY_LENGTH;
  if (trimmed.length > maxLen) {
    return res.status(400).json({
      errorCode: 'BAD_REQUEST',
      error: 'Bad request',
      details: { field: 'Idempotency-Key', maxLength: maxLen },
    });
  }

  (req as AuthRequest).idempotencyKey = trimmed;
  return next();
}
