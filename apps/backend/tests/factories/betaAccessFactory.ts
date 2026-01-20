import type { BetaAccess, Prisma } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { createUser } from './userFactory.js';

export async function createBetaAccess(
  overrides: Partial<Prisma.BetaAccessUncheckedCreateInput> = {}
): Promise<BetaAccess> {
  let userId = overrides.userId;
  if (!userId) {
    const user = await createUser();
    userId = user.id;
  }

  const data: Prisma.BetaAccessUncheckedCreateInput = {
    userId,
    status: 'pending',
    ...overrides,
  };

  return prisma.betaAccess.create({ data });
}
