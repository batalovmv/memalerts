import { PrismaClient } from '@prisma/client';
import { decrementFileHashReference } from '../utils/fileHash.js';
import { getRequestContext } from '../utils/asyncContext.js';
import { logger } from '../utils/logger.js';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Configure Prisma Client with connection pooling
// Connection pooling is configured via DATABASE_URL parameters:
// ?connection_limit=10&pool_timeout=20
// This ensures efficient database connection management under load
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    // Connection pooling is handled via DATABASE_URL parameters
    // Recommended: ?connection_limit=10&pool_timeout=20
  });

function getSlowQueryThresholdMs(): number {
  const raw = parseInt(String(process.env.DB_SLOW_MS || ''), 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return process.env.NODE_ENV === 'production' ? 200 : 100;
}

// Observability middleware:
// - tracks query count + total db time per HTTP request (via AsyncLocalStorage store)
// - logs slow queries (without args payload to avoid leaking PII)
prisma.$use(async (params, next) => {
  const start = process.hrtime.bigint();
  try {
    const result = await next(params);
    return result;
  } finally {
    const end = process.hrtime.bigint();
    const ms = Number(end - start) / 1_000_000;

    const ctx = getRequestContext();
    if (ctx) {
      ctx.db.queryCount += 1;
      ctx.db.totalMs += ms;
    }

    const slowMs = getSlowQueryThresholdMs();
    if (ms >= slowMs) {
      if (ctx) ctx.db.slowQueryCount += 1;
      logger.warn('db.slow_query', {
        requestId: ctx?.requestId,
        model: params.model ?? null,
        action: params.action,
        durationMs: Math.round(ms),
        slowMs,
      });
    }
  }
});

// Middleware to handle file hash reference counting when memes are deleted
prisma.$use(async (params, next) => {
  // Get file hashes before deletion for delete operations
  let fileHashesToDecrement: string[] = [];

  if (params.model === 'Meme' && params.action === 'delete') {
    const meme = params.args?.where ? await prisma.meme.findUnique({
      where: params.args.where,
      select: { fileHash: true },
    }) : null;

    if (meme?.fileHash) {
      fileHashesToDecrement.push(meme.fileHash);
    }
  }

  // Handle deleteMany - get file hashes before deletion
  if (params.model === 'Meme' && params.action === 'deleteMany') {
    const memes = await prisma.meme.findMany({
      where: params.args?.where,
      select: { fileHash: true },
    });

    fileHashesToDecrement = memes
      .map((m) => m.fileHash)
      .filter((hash): hash is string => hash !== null);
  }

  const result = await next(params);

  // Decrement file hash reference counts after deletion
  for (const hash of fileHashesToDecrement) {
    try {
      await decrementFileHashReference(hash);
    } catch (error) {
      console.error('Failed to decrement file hash reference:', error);
    }
  }

  return result;
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;


