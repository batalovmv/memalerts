import pino from 'pino';
import { getRequestContext } from './asyncContext.js';
import { getActiveTraceId } from '../tracing/traceContext.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

function getMinLevel(): LogLevel {
  const raw = String(process.env.LOG_LEVEL || '').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error' || raw === 'silent') return raw;
  // Default: be conservative in production, verbose elsewhere.
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

export type LogMeta = Record<string, unknown>;

function getInstanceId(): string | null {
  const raw = String(process.env.INSTANCE_ID || process.env.HOSTNAME || '').trim();
  return raw.length > 0 ? raw : null;
}

function getTransport() {
  const target = String(process.env.LOG_TRANSPORT_TARGET || '').trim();
  if (!target) return undefined;
  const optionsRaw = String(process.env.LOG_TRANSPORT_OPTIONS || '').trim();
  let options: Record<string, unknown> | undefined;
  if (optionsRaw) {
    try {
      options = JSON.parse(optionsRaw) as Record<string, unknown>;
    } catch {
      // Ignore invalid JSON; fall back to target defaults.
    }
  }
  const level = String(process.env.LOG_TRANSPORT_LEVEL || '').trim();
  return pino.transport({
    target,
    options,
    level: level.length > 0 ? level : undefined,
  });
}

function getDestination() {
  const dest = String(process.env.LOG_DESTINATION || '').trim();
  if (!dest) return undefined;
  return pino.destination({ dest, sync: false });
}

const transport = getTransport();
const destination = transport ? undefined : getDestination();

const baseLogger = pino(
  {
    level: getMinLevel(),
    messageKey: 'event',
    base: {
      service: String(process.env.INSTANCE || '').trim() || null,
      instanceId: getInstanceId(),
      env: String(process.env.NODE_ENV || '').trim() || null,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  transport ?? destination
);

export function log(level: LogLevel, event: string, meta: LogMeta = {}): void {
  const ctx = getRequestContext();
  const traceId = meta.traceId ?? ctx?.traceId ?? getActiveTraceId() ?? null;
  baseLogger[level](
    {
      requestId: meta.requestId ?? ctx?.requestId ?? null,
      traceId,
      userId: meta.userId ?? ctx?.userId ?? null,
      channelId: meta.channelId ?? ctx?.channelId ?? null,
      ...meta,
    },
    event
  );
}

export const logger = {
  debug: (event: string, meta?: LogMeta) => log('debug', event, meta),
  info: (event: string, meta?: LogMeta) => log('info', event, meta),
  warn: (event: string, meta?: LogMeta) => log('warn', event, meta),
  error: (event: string, meta?: LogMeta) => log('error', event, meta),
};
