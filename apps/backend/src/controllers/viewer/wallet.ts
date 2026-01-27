import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { WalletService } from '../../services/WalletService.js';
import { logger } from '../../utils/logger.js';
import { withRetry } from '../../utils/retryTransaction.js';
import { ensureEconomyStateWithStartBonus, ECONOMY_CONSTANTS } from '../../services/economy/economyService.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer, type WalletUpdatedEvent } from '../../realtime/walletBridge.js';

export const getWallet = async (req: AuthRequest, res: Response) => {
  const channelId = req.query.channelId as string | undefined;

  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID is required' });
  }

  const wallet = await WalletService.getWalletOrDefault(prisma, {
    userId: req.userId!,
    channelId,
  });

  res.json(wallet);
};

export const getWalletForChannel = async (req: AuthRequest, res: Response) => {
  const slug = String(req.params.slug || '').trim();

  try {
    // Find channel by slug with timeout protection
    const channelPromise = prisma.channel.findUnique({
      where: { slug }, // fast path (case-sensitive)
      select: { id: true },
    });

    const channelTimeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Channel lookup timeout')), 5000);
    });

    let channel = (await Promise.race([channelPromise, channelTimeout])) as { id: string } | null;

    // Fallback: case-insensitive lookup (handles user-entered mixed-case slugs)
    if (!channel) {
      const ciChannelPromise = prisma.channel.findFirst({
        where: { slug: { equals: slug, mode: 'insensitive' } },
        select: { id: true },
      });
      channel = (await Promise.race([ciChannelPromise, channelTimeout])) as { id: string } | null;
    }

    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const walletTimeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Wallet operation timeout')), 5000);
    });

    const walletPromise = withRetry(
      () =>
        prisma.$transaction(
          async (tx) => {
            const lockedWallet = await WalletService.getWalletForUpdate(tx, {
              userId: req.userId!,
              channelId: channel.id,
            });

            const startBonus = await ensureEconomyStateWithStartBonus({
              tx,
              userId: req.userId!,
              channelId: channel.id,
              lockedWallet,
            });

            return { wallet: startBonus.wallet, startBonusGranted: startBonus.startBonusGranted };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        ),
      { maxRetries: 4, baseDelayMs: 50 }
    );

    const result = (await Promise.race([walletPromise, walletTimeout])) as Awaited<typeof walletPromise>;

    if (result.startBonusGranted) {
      const io = req.app.get('io');
      const walletUpdate: WalletUpdatedEvent = {
        userId: req.userId!,
        channelId: channel.id,
        balance: result.wallet.balance,
        delta: ECONOMY_CONSTANTS.startBonusCoins,
        reason: 'start_bonus',
        channelSlug: slug,
      };
      emitWalletUpdated(io, walletUpdate);
      void relayWalletUpdatedToPeer(walletUpdate);
    }

    res.json(result.wallet);
  } catch (error) {
    const err = error as Error;
    logger.error('wallet.channel_fetch_failed', { errorMessage: err.message });

    // If timeout or database error, return a default wallet instead of failing
    if (err.message?.includes('timeout') || err.message?.includes('ECONNREFUSED')) {
      return res.json({
        id: '',
        userId: req.userId!,
        channelId: '',
        balance: 0,
        updatedAt: new Date(),
      });
    }

    // Handle unique constraint errors gracefully
    if (err.message?.includes('Unique constraint failed')) {
      // Try to fetch existing wallet
      try {
        const channel = await prisma.channel.findUnique({
          where: { slug },
          select: { id: true },
        });

        if (channel) {
          const wallet = await prisma.wallet.findUnique({
            where: {
              userId_channelId: {
                userId: req.userId!,
                channelId: channel.id,
              },
            },
          });

          if (wallet) {
            return res.json(wallet);
          }
        }
      } catch (fetchError) {
        const fetchErr = fetchError as Error;
        logger.error('wallet.channel_fetch_retry_failed', { errorMessage: fetchErr.message });
      }
    }

    res.status(500).json({ error: 'Failed to get wallet', message: err.message });
  }
};
