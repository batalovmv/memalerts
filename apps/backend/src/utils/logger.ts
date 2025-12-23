type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function getMinLevel(): LogLevel {
  const raw = String(process.env.LOG_LEVEL || '').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  // Default: be conservative in production, verbose elsewhere.
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function shouldLog(level: LogLevel): boolean {
  return levelOrder[level] >= levelOrder[getMinLevel()];
}

function safeJsonStringify(value: any): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: 'LOG_SERIALIZATION_FAILED' });
  }
}

export type LogMeta = Record<string, any>;

export function log(level: LogLevel, event: string, meta: LogMeta = {}): void {
  if (!shouldLog(level)) return;

  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...meta,
  };

  const line = safeJsonStringify(payload) + '\n';

  // Use stdout/stderr directly so logs are not affected by console overrides.
  if (level === 'error') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

export const logger = {
  debug: (event: string, meta?: LogMeta) => log('debug', event, meta),
  info: (event: string, meta?: LogMeta) => log('info', event, meta),
  warn: (event: string, meta?: LogMeta) => log('warn', event, meta),
  error: (event: string, meta?: LogMeta) => log('error', event, meta),
};



