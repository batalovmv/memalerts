import type { Wallet } from '@prisma/client';

import { prisma } from '../src/lib/prisma.js';
import { WalletService } from '../src/services/WalletService.js';
import { WalletRepository } from '../src/repositories/WalletRepository.js';
import { createChannel, createUser, createWallet } from './factories/index.js';
import * as metrics from '../src/utils/metrics.js';

describe('WalletService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gets existing wallet or returns null', async () => {
    const wallet = await createWallet({ balance: 123 });
    const existing = await WalletService.getWallet(prisma, { userId: wallet.userId, channelId: wallet.channelId });
    expect(existing?.id).toBe(wallet.id);

    const missing = await WalletService.getWallet(prisma, { userId: 'missing', channelId: 'missing' });
    expect(missing).toBeNull();
  });

  it('returns default wallet when missing', async () => {
    const channel = await createChannel();
    const user = await createUser();
    const fallback = await WalletService.getWalletOrDefault(prisma, { userId: user.id, channelId: channel.id });
    expect(fallback.id).toBe('');
    expect(fallback.userId).toBe(user.id);
    expect(fallback.channelId).toBe(channel.id);
    expect(fallback.balance).toBe(0);
  });

  it('upserts wallets when creating', async () => {
    const channel = await createChannel();
    const user = await createUser();
    const created = await WalletService.getOrCreateWallet(prisma, { userId: user.id, channelId: channel.id });
    expect(created.userId).toBe(user.id);
    expect(created.channelId).toBe(channel.id);

    const again = await WalletService.getOrCreateWallet(prisma, { userId: user.id, channelId: channel.id });
    expect(again.id).toBe(created.id);
  });

  it('creates wallet on first lock and records race conflicts', async () => {
    const lockSpy = vi.spyOn(WalletRepository, 'lockForUpdate');
    const metricSpy = vi.spyOn(metrics, 'recordWalletRaceConflict');
    const lockedWallet: Wallet = {
      id: 'wallet-1',
      userId: 'user-1',
      channelId: 'channel-1',
      balance: 0,
      updatedAt: new Date(),
    };
    lockSpy.mockResolvedValueOnce(null);
    lockSpy.mockResolvedValueOnce(lockedWallet);

    const createMany = vi.fn().mockResolvedValue({ count: 0 });
    const fakeTx = { wallet: { createMany } } as unknown as Parameters<typeof WalletService.getWalletForUpdate>[0];
    const wallet = await WalletService.getWalletForUpdate(fakeTx, { userId: 'user-1', channelId: 'channel-1' });
    expect(wallet.id).toBe('wallet-1');
    expect(metricSpy).toHaveBeenCalledTimes(1);
    expect(createMany).toHaveBeenCalledTimes(1);
  });

  it('increments and decrements balances with metrics', async () => {
    const channel = await createChannel();
    const user = await createUser();
    await createWallet({ userId: user.id, channelId: channel.id, balance: 10 });
    const opSpy = vi.spyOn(metrics, 'recordWalletOperation');

    await prisma.$transaction(async (tx) => {
      await WalletService.incrementBalance(tx, { userId: user.id, channelId: channel.id }, 5);
    });
    await prisma.$transaction(async (tx) => {
      await WalletService.decrementBalance(tx, { userId: user.id, channelId: channel.id }, 3);
    });

    const wallet = await prisma.wallet.findUnique({
      where: { userId_channelId: { userId: user.id, channelId: channel.id } },
      select: { balance: true },
    });
    expect(wallet?.balance).toBe(12);
    expect(opSpy).toHaveBeenCalledWith({ operation: 'increment', amount: 5 });
    expect(opSpy).toHaveBeenCalledWith({ operation: 'decrement', amount: 3 });
  });

  it('does not change balance for zero/negative increments', async () => {
    const channel = await createChannel();
    const user = await createUser();
    await createWallet({ userId: user.id, channelId: channel.id, balance: 7 });
    const opSpy = vi.spyOn(metrics, 'recordWalletOperation');

    await prisma.$transaction(async (tx) => {
      await WalletService.incrementBalance(tx, { userId: user.id, channelId: channel.id }, 0);
      await WalletService.incrementBalance(tx, { userId: user.id, channelId: channel.id }, -5);
    });

    const wallet = await prisma.wallet.findUnique({
      where: { userId_channelId: { userId: user.id, channelId: channel.id } },
      select: { balance: true },
    });
    expect(wallet?.balance).toBe(7);
    expect(opSpy).not.toHaveBeenCalled();
  });

  it('does not emit metrics for zero decrements', async () => {
    const channel = await createChannel();
    const user = await createUser();
    await createWallet({ userId: user.id, channelId: channel.id, balance: 7 });
    const opSpy = vi.spyOn(metrics, 'recordWalletOperation');

    await prisma.$transaction(async (tx) => {
      await WalletService.decrementBalance(tx, { userId: user.id, channelId: channel.id }, 0);
    });

    const wallet = await prisma.wallet.findUnique({
      where: { userId_channelId: { userId: user.id, channelId: channel.id } },
      select: { balance: true },
    });
    expect(wallet?.balance).toBe(7);
    expect(opSpy).not.toHaveBeenCalled();
  });

  it('sets balances and uses locked wallets without extra locks', async () => {
    const channel = await createChannel();
    const user = await createUser();
    const created = await createWallet({ userId: user.id, channelId: channel.id, balance: 0 });
    const lockSpy = vi.spyOn(WalletService, 'getWalletForUpdate');

    await prisma.$transaction(async (tx) => {
      await WalletService.setBalance(
        tx,
        { userId: user.id, channelId: channel.id },
        99,
        { lockedWallet: created }
      );
    });

    const wallet = await prisma.wallet.findUnique({
      where: { userId_channelId: { userId: user.id, channelId: channel.id } },
      select: { balance: true },
    });
    expect(wallet?.balance).toBe(99);
    expect(lockSpy).not.toHaveBeenCalled();
  });
});
