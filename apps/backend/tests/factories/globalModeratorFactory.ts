import type { GlobalModerator, Prisma } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { createUser } from './userFactory.js';

type ModeratorClient = Prisma.TransactionClient | typeof prisma;

export async function createGlobalModerator(
  overrides: Partial<Prisma.GlobalModeratorUncheckedCreateInput> = {},
  opts: { prisma?: ModeratorClient } = {}
): Promise<GlobalModerator> {
  const userId = overrides.userId ?? (await createUser()).id;
  const data: Prisma.GlobalModeratorUncheckedCreateInput = {
    userId,
    grantedAt: new Date(),
    grantedByUserId: null,
    revokedAt: null,
    revokedByUserId: null,
    ...overrides,
  };
  const client = opts.prisma ?? prisma;
  return client.globalModerator.create({ data });
}
