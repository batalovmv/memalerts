import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { activateMemeSchema } from '../shared/index.js';
import { Server } from 'socket.io';

export const viewerController = {
  getChannelBySlug: async (req: any, res: Response) => {
    const { slug } = req.params;

    const channel = await prisma.channel.findUnique({
      where: { slug },
      include: {
        _count: {
          select: {
            memes: { where: { status: 'approved' } },
            users: true,
          },
        },
      },
    });

    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    res.json({
      id: channel.id,
      slug: channel.slug,
      name: channel.name,
      coinPerPointRatio: channel.coinPerPointRatio,
      createdAt: channel.createdAt,
      stats: {
        memesCount: channel._count.memes,
        usersCount: channel._count.users,
      },
    });
  },

  getMe: async (req: AuthRequest, res: Response) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'controllers/viewerController.ts:getMe', message: 'getMe controller called', data: { userId: req.userId, path: req.path, originalUrl: req.originalUrl, cookies: Object.keys(req.cookies || {}) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run5', hypothesisId: 'I' }) }).catch(() => {});
    // #endregion
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
    const channelSlug = req.query.channelSlug as string | undefined;
    const channelId = req.channelId || (req.query.channelId as string | undefined);

    let targetChannelId: string | null = null;

    if (channelSlug) {
      const channel = await prisma.channel.findUnique({
        where: { slug: channelSlug },
        select: { id: true },
      });
      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }
      targetChannelId = channel.id;
    } else if (channelId) {
      targetChannelId = channelId;
    } else {
      return res.status(400).json({ error: 'Channel ID or slug required' });
    }

    const memes = await prisma.meme.findMany({
      where: {
        channelId: targetChannelId,
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


