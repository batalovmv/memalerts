import type { Wallet } from '@prisma/client';
import { WalletRepository, type WalletKey, type WalletRepositoryClient } from '../repositories/WalletRepository.js';
import { recordWalletOperation, recordWalletRaceConflict } from '../utils/metrics.js';

type WalletClient = WalletRepositoryClient & {
  wallet: WalletRepositoryClient['wallet'] & {
    createMany: (args: {
      data: Array<{ userId: string; channelId: string; balance: number }>;
      skipDuplicates?: boolean;
    }) => Promise<{ count: number }>;
    update: (args: {
      where: { userId_channelId: WalletKey };
      data: { balance: number | { increment?: number; decrement?: number } };
    }) => Promise<Wallet>;
    upsert: (args: {
      where: { userId_channelId: WalletKey };
      create: { userId: string; channelId: string; balance: number };
      update: { balance?: { increment?: number; decrement?: number } } | Record<string, never>;
    }) => Promise<Wallet>;
  };
};

type BalanceMutationOptions = {
  lockedWallet?: Wallet | null;
};

export class WalletService {
  static buildDefaultWallet(userId: string, channelId: string): Wallet {
    return {
      id: '',
      userId,
      channelId,
      balance: 0,
      updatedAt: new Date(),
    };
  }

  static async getWallet(client: WalletClient, key: WalletKey): Promise<Wallet | null> {
    return client.wallet.findUnique({ where: { userId_channelId: key } });
  }

  static async getWalletOrDefault(client: WalletClient, key: WalletKey): Promise<Wallet> {
    const wallet = await client.wallet.findUnique({ where: { userId_channelId: key } });
    return wallet ?? WalletService.buildDefaultWallet(key.userId, key.channelId);
  }

  static async getOrCreateWallet(client: WalletClient, key: WalletKey): Promise<Wallet> {
    return client.wallet.upsert({
      where: { userId_channelId: key },
      update: {},
      create: {
        userId: key.userId,
        channelId: key.channelId,
        balance: 0,
      },
    });
  }

  static async getWalletForUpdate(tx: WalletClient, key: WalletKey): Promise<Wallet> {
    const locked = await WalletRepository.lockForUpdate(tx, key);
    if (locked) return locked;

    const inserted = await tx.wallet.createMany({
      data: [{ userId: key.userId, channelId: key.channelId, balance: 0 }],
      skipDuplicates: true,
    });
    if (!inserted?.count) {
      recordWalletRaceConflict();
    }

    const created = await WalletRepository.lockForUpdate(tx, key);
    if (!created) {
      throw new Error('WALLET_CREATE_FAILED');
    }
    return created;
  }

  static async decrementBalance(
    tx: WalletClient,
    key: WalletKey,
    amount: number,
    options: BalanceMutationOptions = {}
  ): Promise<Wallet> {
    if (!options.lockedWallet) {
      await WalletService.getWalletForUpdate(tx, key);
    }
    const updated = await tx.wallet.update({
      where: { userId_channelId: key },
      data: {
        balance: {
          decrement: amount,
        },
      },
    });
    if (amount > 0) {
      recordWalletOperation({ operation: 'decrement', amount });
    }
    return updated;
  }

  static async incrementBalance(
    tx: WalletClient,
    key: WalletKey,
    amount: number,
    options: BalanceMutationOptions = {}
  ): Promise<Wallet> {
    const lockedWallet = options.lockedWallet ?? (await WalletService.getWalletForUpdate(tx, key));
    if (amount <= 0) {
      return lockedWallet;
    }
    const updated = await tx.wallet.update({
      where: { userId_channelId: key },
      data: {
        balance: {
          increment: amount,
        },
      },
    });
    recordWalletOperation({ operation: 'increment', amount });
    return updated;
  }

  static async setBalance(
    tx: WalletClient,
    key: WalletKey,
    balance: number,
    options: BalanceMutationOptions = {}
  ): Promise<Wallet> {
    if (!options.lockedWallet) {
      await WalletService.getWalletForUpdate(tx, key);
    }
    const updated = await tx.wallet.update({
      where: { userId_channelId: key },
      data: { balance },
    });
    recordWalletOperation({ operation: 'set' });
    return updated;
  }
}
