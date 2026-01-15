import type { Prisma, Wallet } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { createChannel } from './channelFactory.js';
import { createUser } from './userFactory.js';

export async function createWallet(
  overrides: Partial<Prisma.WalletUncheckedCreateInput> = {},
): Promise<Wallet> {
  const channelId = overrides.channelId ?? (await createChannel()).id;
  const userId = overrides.userId ?? (await createUser()).id;
  const data: Prisma.WalletUncheckedCreateInput = {
    channelId,
    userId,
    balance: 0,
    ...overrides,
  };
  return prisma.wallet.create({ data });
}
