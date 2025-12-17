import { PrismaClient } from '@prisma/client';
import { decrementFileHashReference } from '../utils/fileHash.js';

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


