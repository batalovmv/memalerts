import { MemeRepository } from './MemeRepository.js';
import { WalletService } from '../../services/WalletService.js';
import { AppError } from '../../shared/errors.js';
import { prisma } from '../../infrastructure/prisma.js';

interface ListChannelMemesParams {
  channelId: string;
  limit: number;
  offset: number;
  sortBy: 'createdAt' | 'priceCoins' | 'activationsCount';
  sortOrder: 'asc' | 'desc';
  tags?: string[];
  search?: string;
}

interface ActivateMemeParams {
  memeId: string;
  channelId: string;
  userId: string;
  volume: number;
}

export class MemeService {
  private memeRepo = new MemeRepository();

  async listChannelMemes(params: ListChannelMemesParams) {
    const { items, total } = await this.memeRepo.findByChannel(params);
    return { items, total };
  }

  async getMemeById(memeId: string) {
    return this.memeRepo.findById(memeId);
  }

  async activateMeme(params: ActivateMemeParams) {
    const { memeId, channelId, userId, volume } = params;

    const meme = await this.memeRepo.findById(memeId);
    if (!meme) {
      throw new AppError('NOT_FOUND', 'Meme not found');
    }

    if (meme.cooldownMinutes && meme.lastActivatedAt) {
      const cooldownEnd = new Date(meme.lastActivatedAt.getTime() + meme.cooldownMinutes * 60 * 1000);
      if (Date.now() < cooldownEnd.getTime()) {
        throw new AppError('MEME_ON_COOLDOWN', 'Meme is on cooldown', {
          details: { cooldownUntil: cooldownEnd.toISOString() },
        });
      }
    }

    const priceCoins = meme.priceCoins;
    const balanceAfter = await this.chargeUser({ userId, channelId, amount: priceCoins });

    const activation = await this.memeRepo.createActivation({
      channelMemeId: memeId,
      userId,
      channelId,
      priceCoins,
      volume,
    });

    await this.memeRepo.updateLastActivated(memeId);

    let cooldownUntil: Date | null = null;
    if (meme.cooldownMinutes) {
      cooldownUntil = new Date(Date.now() + meme.cooldownMinutes * 60 * 1000);
    }

    return {
      activationId: activation.id,
      balanceAfter,
      cooldownUntil,
    };
  }

  private async chargeUser(params: { userId: string; channelId: string; amount: number }) {
    const { userId, channelId, amount } = params;
    if (amount <= 0) {
      const wallet = await WalletService.getWalletOrDefault(prisma, { userId, channelId });
      return wallet.balance;
    }

    return prisma.$transaction(async (tx) => {
      const wallet = await WalletService.getWalletForUpdate(tx, { userId, channelId });
      if (wallet.balance < amount) {
        throw new AppError('INSUFFICIENT_BALANCE', 'Insufficient balance', {
          details: { balance: wallet.balance, priceCoins: amount },
        });
      }
      const updated = await WalletService.decrementBalance(tx, { userId, channelId }, amount, {
        lockedWallet: wallet,
      });
      return updated.balance;
    });
  }
}
