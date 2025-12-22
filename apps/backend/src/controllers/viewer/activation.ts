import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import type { Server } from 'socket.io';
import { prisma } from '../../lib/prisma.js';
import { activateMemeSchema } from '../../shared/index.js';
import { getActivePromotion, calculatePriceWithDiscount } from '../../utils/promotions.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer } from '../../realtime/walletBridge.js';

export const activateMeme = async (req: AuthRequest, res: Response) => {
  const { id: memeId } = req.params;
  const io: Server = req.app.get('io');

  try {
    const parsed = activateMemeSchema.parse({ memeId });

    // Get user wallet and meme in transaction
    const result = await prisma.$transaction(async (tx) => {
      const meme = await tx.meme.findUnique({
        where: { id: parsed.memeId },
        include: { channel: true },
      });

      if (!meme) {
        throw new Error('Meme not found');
      }

      if (meme.status !== 'approved') {
        throw new Error('Meme is not approved');
      }

      // Find or create wallet for this user and channel
      let wallet = await tx.wallet.findUnique({
        where: {
          userId_channelId: {
            userId: req.userId!,
            channelId: meme.channelId,
          },
        },
      });

      if (!wallet) {
        // Create wallet with 0 balance if it doesn't exist
        wallet = await tx.wallet.create({
          data: {
            userId: req.userId!,
            channelId: meme.channelId,
            balance: 0,
          },
        });
      }

      // Check if user is the owner of the channel (free activation for channel owner)
      const isChannelOwner = req.channelId === meme.channelId;

      // Check for active promotion
      const promotion = await getActivePromotion(meme.channelId);
      const finalPrice = promotion ? calculatePriceWithDiscount(meme.priceCoins, promotion.discountPercent) : meme.priceCoins;

      let updatedWallet = wallet;
      let coinsSpent = 0;

      if (!isChannelOwner) {
        // Only check balance and deduct coins if user is not the channel owner
        if (wallet.balance < finalPrice) {
          throw new Error('Insufficient balance');
        }

        // Deduct coins
        updatedWallet = await tx.wallet.update({
          where: {
            userId_channelId: {
              userId: req.userId!,
              channelId: meme.channelId,
            },
          },
          data: {
            balance: {
              decrement: finalPrice,
            },
          },
        });
        coinsSpent = finalPrice;
      }
      // If isChannelOwner, coinsSpent remains 0 and wallet is not updated

      const activation = await tx.memeActivation.create({
        data: {
          channelId: meme.channelId,
          userId: req.userId!,
          memeId: meme.id,
          coinsSpent: coinsSpent,
          status: 'queued',
        },
      });

      const sender = await tx.user.findUnique({
        where: { id: req.userId! },
        select: { displayName: true },
      });

      return { activation, meme, wallet: updatedWallet, senderDisplayName: sender?.displayName ?? null };
    });

    // Emit to overlay.
    // IMPORTANT: Always emit to a normalized room name to avoid case mismatches
    // between stored slugs, older clients, and token-based overlay joins.
    const channelSlug = String(result.meme.channel.slug || '').toLowerCase();
    io.to(`channel:${channelSlug}`).emit('activation:new', {
      id: result.activation.id,
      memeId: result.activation.memeId,
      type: result.meme.type,
      fileUrl: result.meme.fileUrl,
      durationMs: result.meme.durationMs,
      title: result.meme.title,
      senderDisplayName: result.senderDisplayName,
    });

    // Publish wallet update so other instances (beta/prod) can emit it to connected clients.
    // Also emit locally for immediate feedback to current instance.
    if (result.activation.coinsSpent && result.activation.coinsSpent > 0) {
      const walletUpdateData = {
        userId: result.activation.userId,
        channelId: result.activation.channelId,
        balance: result.wallet.balance,
        delta: -result.activation.coinsSpent,
        reason: 'meme_activation',
        channelSlug: result.meme.channel.slug,
      };
      emitWalletUpdated(io, walletUpdateData as any);
      void relayWalletUpdatedToPeer(walletUpdateData as any);
    }

    // Get promotion info for response
    const promotion = await getActivePromotion(result.meme.channelId);
    const originalPrice = result.meme.priceCoins;
    const finalPrice = promotion ? calculatePriceWithDiscount(originalPrice, promotion.discountPercent) : originalPrice;

    res.json({
      activation: result.activation,
      wallet: result.wallet,
      originalPrice,
      finalPrice,
      discountApplied: promotion ? promotion.discountPercent : 0,
      isFree: req.channelId === result.meme.channelId, // Indicate if activation was free for channel owner
    });
  } catch (error: any) {
    if (error.message === 'Wallet not found' || error.message === 'Meme not found') {
      return res.status(404).json({ error: error.message });
    }
    if (error.message === 'Insufficient balance' || error.message === 'Meme is not approved') {
      return res.status(400).json({ error: error.message });
    }
    throw error;
  }
};


