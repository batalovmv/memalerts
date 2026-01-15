import type { Response } from 'express';
import type { ErrorCode } from './errors.js';

export class ApiError extends Error {
  public readonly status: number;
  public readonly errorCode: ErrorCode;
  public readonly details?: unknown;

  constructor(params: { status: number; errorCode: ErrorCode; message?: string; details?: unknown }) {
    super(params.message || params.errorCode);
    this.name = 'ApiError';
    this.status = params.status;
    this.errorCode = params.errorCode;
    this.details = params.details;
  }
}

export type ApiErrorPayload = {
  status: number;
  errorCode: ErrorCode;
  error?: string;
  details?: unknown;
};

export function sendError(res: Response, payload: ApiErrorPayload) {
  const { status, errorCode, error, details } = payload;
  return res.status(status).json({
    errorCode,
    ...(error ? { error } : {}),
    ...(details !== undefined ? { details } : {}),
  });
}








