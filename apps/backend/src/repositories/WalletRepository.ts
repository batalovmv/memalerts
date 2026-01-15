import { Prisma } from '@prisma/client';
import type { Wallet } from '@prisma/client';
import { recordWalletRaceConflict } from '../utils/metrics.js';

export type WalletKey = {
  userId: string;
  channelId: string;
};

export type WalletRepositoryClient = {
  wallet: {
    findUnique: (args: { where: { userId_channelId: WalletKey } }) => Promise<Wallet | null>;
    create: (args: { data: { userId: string; channelId: string; balance: number } }) => Promise<Wallet>;
  };
  $queryRaw: <T = unknown>(query: Prisma.Sql) => Promise<T>;
};

function isWalletConflictError(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : '';
  if (code === 'P2034') return true;
  const message = error instanceof Error ? error.message : String(error || '');
  return (
    message.includes('deadlock detected') ||
    message.includes('could not serialize access') ||
    message.includes('could not obtain lock') ||
    message.includes('lock timeout') ||
    message.includes('Lock timeout') ||
    message.includes('canceling statement due to lock timeout')
  );
}

export class WalletRepository {
  static async lockForUpdate(tx: WalletRepositoryClient, key: WalletKey): Promise<Wallet | null> {
    try {
      const rows = await tx.$queryRaw<Wallet[]>(
        Prisma.sql`SELECT * FROM "Wallet" WHERE "userId" = ${key.userId} AND "channelId" = ${key.channelId} FOR UPDATE`
      );
      return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    } catch (error) {
      if (isWalletConflictError(error)) {
        recordWalletRaceConflict();
      }
      throw error;
    }
  }
}
