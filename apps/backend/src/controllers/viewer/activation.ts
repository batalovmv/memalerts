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

    // Fetch meme once (outside transaction) to keep the transaction short and avoid nested DB clients.
    const meme = await prisma.meme.findUnique({
      where: { id: parsed.memeId },
      include: { channel: true },
    });

    if (!meme) {
      throw new Error('Meme not found');
    }

    if (meme.status !== 'approved') {
      throw new Error('Meme is not approved');
    }

    // Promotion lookup (outside transaction): best-effort cache exists in utils/promotions.ts.
    const promotion = await getActivePromotion(meme.channelId);
    const originalPrice = meme.priceCoins;
    const finalPrice = promotion ? calculatePriceWithDiscount(originalPrice, promotion.discountPercent) : originalPrice;

    // Get user wallet + create activation in transaction
    const result = await prisma.$transaction(async (tx) => {
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
        wallet = await tx.wallet.create({
          data: {
            userId: req.userId!,
            channelId: meme.channelId,
            balance: 0,
          },
        });
      }

      // Channel owner gets free activation.
      const isChannelOwner = req.channelId === meme.channelId;

      let updatedWallet = wallet;
      let coinsSpent = 0;

      if (!isChannelOwner) {
        if (wallet.balance < finalPrice) {
          throw new Error('Insufficient balance');
        }

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

      const activation = await tx.memeActivation.create({
        data: {
          channelId: meme.channelId,
          userId: req.userId!,
          memeId: meme.id,
          coinsSpent,
          status: 'queued',
        },
      });

      const sender = await tx.user.findUnique({
        where: { id: req.userId! },
        select: { displayName: true },
      });

      return { activation, wallet: updatedWallet, senderDisplayName: sender?.displayName ?? null };
    });

    // Emit to overlay.
    // IMPORTANT: Always emit to a normalized room name to avoid case mismatches
    // between stored slugs, older clients, and token-based overlay joins.
    const channelSlug = String(meme.channel.slug || '').toLowerCase();
    io.to(`channel:${channelSlug}`).emit('activation:new', {
      id: result.activation.id,
      memeId: result.activation.memeId,
      type: meme.type,
      fileUrl: meme.fileUrl,
      durationMs: meme.durationMs,
      title: meme.title,
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
        channelSlug: meme.channel.slug,
      };
      emitWalletUpdated(io, walletUpdateData as any);
      void relayWalletUpdatedToPeer(walletUpdateData as any);
    }

    res.json({
      activation: result.activation,
      wallet: result.wallet,
      originalPrice,
      finalPrice,
      discountApplied: promotion ? promotion.discountPercent : 0,
      isFree: req.channelId === meme.channelId, // Indicate if activation was free for channel owner
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


