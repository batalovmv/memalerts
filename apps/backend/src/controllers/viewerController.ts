import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { activateMemeSchema } from '../shared';
import { Server } from 'socket.io';

export const viewerController = {
  getMe: async (req: AuthRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      include: {
        wallet: true,
        channel: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      displayName: user.displayName,
      role: user.role,
      channelId: user.channelId,
      wallet: user.wallet,
    });
  },

  getWallet: async (req: AuthRequest, res: Response) => {
    const wallet = await prisma.wallet.findUnique({
      where: { userId: req.userId! },
    });

    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    res.json(wallet);
  },

  getMemes: async (req: AuthRequest, res: Response) => {
    const channelId = req.channelId || req.query.channelId as string;

    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID required' });
    }

    const memes = await prisma.meme.findMany({
      where: {
        channelId,
        status: 'approved',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(memes);
  },

  activateMeme: async (req: AuthRequest, res: Response) => {
    const { id: memeId } = req.params;
    const io: Server = req.app.get('io');

    try {
      const parsed = activateMemeSchema.parse({ memeId });

      // Get user wallet and meme in transaction
      const result = await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUnique({
          where: { userId: req.userId! },
        });

        if (!wallet) {
          throw new Error('Wallet not found');
        }

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

        if (wallet.balance < meme.priceCoins) {
          throw new Error('Insufficient balance');
        }

        // Deduct coins and create activation
        const updatedWallet = await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balance: {
              decrement: meme.priceCoins,
            },
          },
        });

        const activation = await tx.memeActivation.create({
          data: {
            channelId: meme.channelId,
            userId: req.userId!,
            memeId: meme.id,
            coinsSpent: meme.priceCoins,
            status: 'queued',
          },
        });

        return { activation, meme, wallet: updatedWallet };
      });

      // Emit to overlay
      io.to(`channel:${result.meme.channel.slug}`).emit('activation:new', {
        id: result.activation.id,
        memeId: result.activation.memeId,
        type: result.meme.type,
        fileUrl: result.meme.fileUrl,
        durationMs: result.meme.durationMs,
        title: result.meme.title,
      });

      res.json({
        activation: result.activation,
        wallet: result.wallet,
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
  },
};


