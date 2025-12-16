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
        memes: {
          where: { status: 'approved' },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            title: true,
            type: true,
            fileUrl: true,
            durationMs: true,
            priceCoins: true,
            createdAt: true,
          },
        },
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
      memes: channel.memes,
      stats: {
        memesCount: channel._count.memes,
        usersCount: channel._count.users,
      },
    });
  },

  getMe: async (req: AuthRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      include: {
        wallets: true,
        channel: {
          select: {
            id: true,
            slug: true,
            name: true,
          },
        },
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
      channel: user.channel,
      wallets: user.wallets,
    });
  },

  getWallet: async (req: AuthRequest, res: Response) => {
    const channelId = req.query.channelId as string | undefined;
    
    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID is required' });
    }

    const wallet = await prisma.wallet.findUnique({
      where: { 
        userId_channelId: {
          userId: req.userId!,
          channelId: channelId,
        }
      },
    });

    if (!wallet) {
      // Return wallet with 0 balance if not found
      return res.json({
        id: '',
        userId: req.userId!,
        channelId: channelId,
        balance: 0,
        updatedAt: new Date(),
      });
    }

    res.json(wallet);
  },

  getWalletForChannel: async (req: AuthRequest, res: Response) => {
    const { slug } = req.params;
    
    // Find channel by slug
    const channel = await prisma.channel.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Find or create wallet for this user and channel
    let wallet = await prisma.wallet.findUnique({
      where: {
        userId_channelId: {
          userId: req.userId!,
          channelId: channel.id,
        }
      },
    });

    if (!wallet) {
      // Create wallet with 0 balance if it doesn't exist
      wallet = await prisma.wallet.create({
        data: {
          userId: req.userId!,
          channelId: channel.id,
          balance: 0,
        },
      });
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
            }
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

        if (wallet.balance < meme.priceCoins) {
          throw new Error('Insufficient balance');
        }

        // Deduct coins and create activation
        const updatedWallet = await tx.wallet.update({
          where: { 
            userId_channelId: {
              userId: req.userId!,
              channelId: meme.channelId,
            }
          },
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


