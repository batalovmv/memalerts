import { PrismaClient, type Prisma } from '@prisma/client';
import { decrementFileHashReferenceInTx, deleteFileHashStorage } from '../utils/fileHash.js';
import { getRequestContext } from '../utils/asyncContext.js';
import { logger } from '../utils/logger.js';
import { recordDbSlowQuery } from '../utils/metrics.js';

type PrismaGlobalStore = {
  prisma?: PrismaClient;
  middlewareRegistered?: boolean;
};

const globalForPrisma = globalThis as unknown as PrismaGlobalStore;
const processForPrisma = process as NodeJS.Process & PrismaGlobalStore;
const isTestEnv =
  process.env.MEMALERTS_TEST === '1' ||
  process.env.VITEST === '1' ||
  process.env.VITEST === 'true' ||
  process.env.NODE_ENV === 'test';
const prismaStore = isTestEnv ? processForPrisma : globalForPrisma;

type FileHashHooks = {
  decrementFileHashReferenceInTx: typeof decrementFileHashReferenceInTx;
  deleteFileHashStorage: typeof deleteFileHashStorage;
};

const fileHashHooksStore = processForPrisma as NodeJS.Process & {
  __fileHashHooks?: FileHashHooks;
};
if (!fileHashHooksStore.__fileHashHooks) {
  fileHashHooksStore.__fileHashHooks = {
    decrementFileHashReferenceInTx,
    deleteFileHashStorage,
  };
}

function getFileHashHooks(): FileHashHooks {
  return (
    fileHashHooksStore.__fileHashHooks ?? {
      decrementFileHashReferenceInTx,
      deleteFileHashStorage,
    }
  );
}

export function setFileHashHooksForTest(overrides: Partial<FileHashHooks>): void {
  if (process.env.MEMALERTS_TEST !== '1') return;
  fileHashHooksStore.__fileHashHooks = {
    ...(fileHashHooksStore.__fileHashHooks ?? {
      decrementFileHashReferenceInTx,
      deleteFileHashStorage,
    }),
    ...overrides,
  };
}

// Configure Prisma Client with connection pooling
// Connection pooling is configured via DATABASE_URL parameters:
// ?connection_limit=10&pool_timeout=20
// This ensures efficient database connection management under load
const prismaLog: Prisma.LogDefinition[] = [
  { emit: 'event', level: 'query' },
  { emit: 'stdout', level: 'error' },
];
if (process.env.NODE_ENV === 'development') {
  prismaLog.push({ emit: 'stdout', level: 'warn' });
  prismaLog.push({ emit: 'stdout', level: 'query' });
}
export const prisma =
  prismaStore.prisma ??
  new PrismaClient({
    log: prismaLog,
    // Connection pooling is handled via DATABASE_URL parameters
    // Recommended: ?connection_limit=10&pool_timeout=20
  });

if (!prismaStore.prisma) {
  prismaStore.prisma = prisma;
  prismaStore.middlewareRegistered = false;
  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
  }
}

function getSlowQueryThresholdMs(): number {
  const raw = parseInt(String(process.env.DB_SLOW_MS || ''), 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 500;
}

function normalizeQueryForLog(query: string): string {
  return query.replace(/\s+/g, ' ').trim().slice(0, 500);
}

const MAX_SLOW_QUERIES = 3;

function getTransactionOptions() {
  if (process.env.NODE_ENV !== 'test') return undefined;
  return {
    maxWait: 10_000,
    timeout: 20_000,
  };
}

if (!prismaStore.middlewareRegistered) {
  // Observability hooks:
  // - tracks query count + total db time per request (AsyncLocalStorage)
  // - logs slow queries (no params payload to avoid leaking PII)
  const prismaEvents = prisma as unknown as {
    $on: (event: 'query', callback: (event: Prisma.QueryEvent) => void) => void;
  };
  prismaEvents.$on('query', (event: Prisma.QueryEvent) => {
    const ctx = getRequestContext();
    if (ctx) {
      ctx.db.queryCount += 1;
      ctx.db.totalMs += event.duration;
    }

    const slowMs = getSlowQueryThresholdMs();
    const durationMs = Math.round(event.duration);
    if (durationMs < slowMs) return;

    const query = normalizeQueryForLog(event.query || '');
    recordDbSlowQuery({ durationMs });

    if (ctx) {
      ctx.db.slowQueryCount += 1;
      if (!ctx.db.slowQueries) ctx.db.slowQueries = [];
      if (ctx.db.slowQueries.length < MAX_SLOW_QUERIES) {
        ctx.db.slowQueries.push({ durationMs, query: query || null });
      }
    }

    logger.warn('db.slow_query', {
      requestId: ctx?.requestId,
      durationMs,
      slowMs,
      query: query || null,
      target: event.target ?? null,
    });
  });

  // Middleware to handle file hash reference counting when memes/submissions are deleted.
  prisma.$use(async (params, next) => {
    const skipFlag = '__skipFileHashRefCount' as const;
    if (params.args && (params.args as Record<string, unknown>)[skipFlag]) {
      delete (params.args as Record<string, unknown>)[skipFlag];
      return next(params);
    }

    const isDelete = params.action === 'delete' || params.action === 'deleteMany';
    const isMeme = params.model === 'Meme';
    const isSubmission = params.model === 'MemeSubmission';
    if (!isDelete || (!isMeme && !isSubmission)) {
      return next(params);
    }

    const hooks = getFileHashHooks();
    const deleteTargets: Array<{ hash: string; publicPath: string }> = [];
    const isDedupPath = (p: string) => p.startsWith('/uploads/memes/');

    const result = await prisma.$transaction(async (tx) => {
      let hashesToDecrement: string[] = [];

      if (isMeme) {
        if (params.action === 'delete') {
          const meme = params.args?.where
            ? await tx.meme.findUnique({
                where: params.args.where,
                select: { fileHash: true },
              })
            : null;
          if (meme?.fileHash) hashesToDecrement.push(String(meme.fileHash));
        } else {
          const memes = await tx.meme.findMany({
            where: params.args?.where,
            select: { fileHash: true },
          });
          hashesToDecrement = memes.map((m) => m.fileHash).filter((hash): hash is string => hash !== null);
        }
      } else {
        const submissions =
          params.action === 'delete'
            ? params.args?.where
              ? [
                  await tx.memeSubmission.findUnique({
                    where: params.args.where,
                    select: { fileHash: true, fileUrlTemp: true },
                  }),
                ]
              : [null]
            : await tx.memeSubmission.findMany({
                where: params.args?.where,
                select: { fileHash: true, fileUrlTemp: true },
              });

        const pathCounts = new Map<string, number>();
        for (const row of submissions) {
          if (!row) continue;
          if (row.fileHash) {
            hashesToDecrement.push(String(row.fileHash));
            continue;
          }
          const p = String(row.fileUrlTemp || '');
          if (!p || !isDedupPath(p)) continue;
          pathCounts.set(p, (pathCounts.get(p) || 0) + 1);
        }

        if (pathCounts.size > 0) {
          const rows = await tx.fileHash.findMany({
            where: { filePath: { in: Array.from(pathCounts.keys()) } },
            select: { hash: true, filePath: true },
          });
          for (const row of rows) {
            const count = pathCounts.get(String(row.filePath || '')) || 0;
            for (let i = 0; i < count; i += 1) {
              hashesToDecrement.push(String(row.hash));
            }
          }
        }
      }

      const deleteArgs = { ...(params.args || {}), [skipFlag]: true } as Record<string, unknown>;
      const deleteResult = isMeme
        ? params.action === 'delete'
          ? await tx.meme.delete(deleteArgs as Prisma.MemeDeleteArgs)
          : await tx.meme.deleteMany(deleteArgs as Prisma.MemeDeleteManyArgs)
        : params.action === 'delete'
          ? await tx.memeSubmission.delete(deleteArgs as Prisma.MemeSubmissionDeleteArgs)
          : await tx.memeSubmission.deleteMany(deleteArgs as Prisma.MemeSubmissionDeleteManyArgs);

      for (const hash of hashesToDecrement) {
        try {
          const publicPath = await hooks.decrementFileHashReferenceInTx(tx, hash);
          if (publicPath) deleteTargets.push({ hash, publicPath });
        } catch (error) {
          const err = error as Error;
          logger.error('db.filehash_decrement_failed', { hash, errorMessage: err.message });
          throw error;
        }
      }

      return deleteResult;
    }, getTransactionOptions());

    for (const target of deleteTargets) {
      await hooks.deleteFileHashStorage(target.hash, target.publicPath);
    }

    return result;
  });

  prismaStore.middlewareRegistered = true;
}
