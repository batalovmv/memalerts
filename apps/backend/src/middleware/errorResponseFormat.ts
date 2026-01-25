import type { NextFunction, Request, Response } from 'express';
import {
  ERROR_MESSAGES,
  ERROR_MESSAGES_RU,
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

function pickPreferredLanguage(req: Request): 'ru' | 'en' {
  const header = (req as Partial<Request>)?.headers?.['accept-language'];
  if (typeof header !== 'string') return 'en';

  const hasRussian = header
    .toLowerCase()
    .split(',')
    .map((entry) => entry.trim())
    .some((entry) => entry.startsWith('ru'));

  return hasRussian ? 'ru' : 'en';
}

function pickErrorMessage(code: ErrorCode, body: unknown, language: 'ru' | 'en'): string {
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

  if (language === 'ru') return ERROR_MESSAGES_RU[code] ?? ERROR_MESSAGES[code] ?? 'Error';
  return ERROR_MESSAGES[code] ?? 'Error';
}

function pickHint(code: ErrorCode, body: unknown): string | undefined {
  const explicitHint =
    body && typeof body === 'object' && typeof (body as { hint?: unknown }).hint === 'string'
      ? (body as { hint: string }).hint
      : null;
  if (explicitHint && explicitHint.trim().length > 0) return explicitHint;

  switch (code) {
    case 'CSRF_INVALID':
      return 'Refresh the page and try again.';
    case 'SESSION_EXPIRED':
      return 'Please sign in again.';
    case 'UNAUTHORIZED':
      return 'Sign in to continue.';
    case 'FORBIDDEN':
      return 'You do not have permission for this action.';
    case 'TOO_MANY_REQUESTS':
    case 'RATE_LIMITED':
      return 'Slow down and retry in a moment.';
    case 'USER_SPAM_BANNED':
      return 'Please wait before submitting again.';
    case 'OAUTH_STATE_MISMATCH':
      return 'Restart the login flow.';
    case 'UPLOAD_TIMEOUT':
      return 'Retry the upload with a stable connection.';
    case 'FILE_TOO_LARGE':
      return 'Use a smaller file and try again.';
    case 'VIDEO_TOO_LONG':
      return 'Shorten the video and try again.';
    case 'INVALID_MEDIA_URL':
    case 'INVALID_MEDIA_TYPE':
    case 'INVALID_FILE_TYPE':
    case 'INVALID_FILE_CONTENT':
      return 'Use a supported file format and try again.';
    case 'BOT_NOT_CONFIGURED':
    case 'TWITCH_BOT_NOT_CONFIGURED':
    case 'YOUTUBE_BOT_NOT_CONFIGURED':
    case 'VKVIDEO_BOT_NOT_CONFIGURED':
    case 'TROVO_BOT_NOT_CONFIGURED':
    case 'KICK_BOT_NOT_CONFIGURED':
      return 'Enable the bot in channel settings.';
    default:
      return undefined;
  }
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
    const error = pickErrorMessage(code, body, pickPreferredLanguage(req));
    const details =
      body && typeof body === 'object' && 'details' in body ? (body as { details?: unknown }).details : undefined;
    const hint = pickHint(code, body);

    const payload: ApiErrorResponse = {
      errorCode: code,
      error,
      requestId,
      traceId,
      ...(details !== undefined ? { details } : {}),
      ...(hint ? { hint } : {}),
    };
    return originalJson(payload);
  }) as Response['json'];

  next();
}
