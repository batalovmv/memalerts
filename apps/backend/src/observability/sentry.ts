import type { ErrorRequestHandler, RequestHandler } from 'express';
import * as Sentry from '@sentry/node';

let sentryEnabled = false;

function scrubEmailFields(target: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(target)) {
    if (!key.toLowerCase().includes('email')) continue;
    if (typeof value === 'string' && value.length > 0) {
      target[key] = '[redacted]';
    } else {
      target[key] = null;
    }
  }
}

function scrubEvent(event: Sentry.Event): Sentry.Event | null {
  if (event.user && 'email' in event.user) {
    delete event.user.email;
  }
  if (event.request?.data && typeof event.request.data === 'object' && event.request.data) {
    scrubEmailFields(event.request.data as Record<string, unknown>);
  }
  if (event.extra && typeof event.extra === 'object') {
    scrubEmailFields(event.extra as Record<string, unknown>);
  }
  return event;
}

function resolveRelease(): string | undefined {
  return (
    process.env.SENTRY_RELEASE ||
    process.env.RELEASE ||
    process.env.GIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    undefined
  );
}

export function initSentry(): void {
  const dsn = String(process.env.SENTRY_DSN || '').trim();
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: resolveRelease(),
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  });

  sentryEnabled = true;
}

export function sentryRequestHandler(): RequestHandler {
  if (!sentryEnabled) return (_req, _res, next) => next();
  return Sentry.Handlers.requestHandler();
}

export function sentryErrorHandler(): ErrorRequestHandler {
  if (!sentryEnabled) return (err, _req, _res, next) => next(err);
  return Sentry.Handlers.errorHandler();
}
