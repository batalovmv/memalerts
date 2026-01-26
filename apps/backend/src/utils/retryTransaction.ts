import { Prisma } from '@prisma/client';
import { logger } from './logger.js';

// Prisma error codes
const RETRYABLE_PRISMA_CODES = [
  'P2034', // Write conflict / concurrent update
  'P1001', // Can't reach database server (transient)
  'P1008', // Operations timed out
  'P1017', // Server has closed the connection
];

// PostgreSQL error codes
const RETRYABLE_PG_CODES = [
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
  '57014', // query_canceled (timeout)
];

// Error message patterns to detect retryable conditions
const RETRYABLE_MESSAGE_PATTERNS = [
  'could not serialize access',
  'deadlock detected',
  'lock timeout',
  'connection reset',
  'ECONNRESET',
  'write conflict',
  'Transaction failed due to a write conflict',
];

type RetryOptions = {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

function isRetryableError(error: unknown): boolean {
  const isPrismaKnown = error instanceof Prisma.PrismaClientKnownRequestError;
  const errorCode = isPrismaKnown
    ? error.code
    : (error as { code?: string })?.code;
  const errorMessage = error instanceof Error ? error.message : String(error);

  // Check Prisma codes
  if (errorCode && RETRYABLE_PRISMA_CODES.includes(errorCode)) {
    return true;
  }

  // Check PostgreSQL codes
  if (errorCode && RETRYABLE_PG_CODES.includes(errorCode)) {
    return true;
  }

  // Check error message patterns
  const lowerMessage = errorMessage.toLowerCase();
  if (RETRYABLE_MESSAGE_PATTERNS.some((pattern) => lowerMessage.includes(pattern.toLowerCase()))) {
    return true;
  }

  // Check if error code is embedded in error string
  const errorStr = String(error);
  if ([...RETRYABLE_PRISMA_CODES, ...RETRYABLE_PG_CODES].some((code) => errorStr.includes(code))) {
    return true;
  }

  return false;
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 50, maxDelayMs = 1000 } = options;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      const shouldRetry = isRetryableError(error);
      const errorCode = error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code
        : (error as { code?: string })?.code;

      if (!shouldRetry || attempt === maxRetries) {
        throw error;
      }

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      const jitter = Math.random() * delay * 0.1;

      logger.warn('transaction.retry', {
        attempt: attempt + 1,
        maxRetries,
        errorCode,
        errorMessage: error instanceof Error ? error.message.slice(0, 100) : undefined,
        delayMs: Math.round(delay + jitter),
      });

      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
    }
  }

  throw lastError;
}
