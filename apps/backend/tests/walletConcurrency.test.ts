import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { WalletService } from '../src/services/WalletService.js';
import { createChannel, createUser } from './factories/index.js';

function rand(): string {
  return Math.random().toString(16).slice(2);
}

describe('wallet concurrency', () => {
  it('applies concurrent increments without lost updates', async () => {
    const channel = await createChannel({ slug: `wallet-${rand()}`, name: `Wallet ${rand()}` });

    const user = await createUser({ displayName: `User ${rand()}`, role: 'viewer', hasBetaAccess: false });

    const increments = 100;
    const delta = 1;

    await Promise.all(
      Array.from({ length: increments }, () =>
        prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await WalletService.incrementBalance(tx, { userId: user.id, channelId: channel.id }, delta);
        })
      )
    );

    const wallet = await prisma.wallet.findUnique({
      where: { userId_channelId: { userId: user.id, channelId: channel.id } },
      select: { balance: true },
    });

    expect(wallet?.balance).toBe(increments * delta);
  });
});
