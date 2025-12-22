import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';

export const getWallet = async (req: AuthRequest, res: Response) => {
  const channelId = req.query.channelId as string | undefined;

  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID is required' });
  }

  const wallet = await prisma.wallet.findUnique({
    where: {
      userId_channelId: {
        userId: req.userId!,
        channelId: channelId,
      },
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

    let channel = (await Promise.race([channelPromise, channelTimeout])) as any;

    // Fallback: case-insensitive lookup (handles user-entered mixed-case slugs)
    if (!channel) {
      const ciChannelPromise = prisma.channel.findFirst({
        where: { slug: { equals: slug, mode: 'insensitive' } },
        select: { id: true },
      });
      channel = (await Promise.race([ciChannelPromise, channelTimeout])) as any;
    }

    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Use upsert to find or create wallet atomically (prevents race conditions)
    const walletPromise = prisma.wallet.upsert({
      where: {
        userId_channelId: {
          userId: req.userId!,
          channelId: channel.id,
        },
      },
      update: {}, // If exists, just return it
      create: {
        userId: req.userId!,
        channelId: channel.id,
        balance: 0,
      },
    });

    const walletTimeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Wallet operation timeout')), 5000);
    });

    const wallet = (await Promise.race([walletPromise, walletTimeout])) as any;

    res.json(wallet);
  } catch (error: any) {
    console.error('Error in getWalletForChannel:', error);

    // If timeout or database error, return a default wallet instead of failing
    if (error.message?.includes('timeout') || error.message?.includes('ECONNREFUSED')) {
      return res.json({
        id: '',
        userId: req.userId!,
        channelId: '',
        balance: 0,
        updatedAt: new Date(),
      });
    }

    // Handle unique constraint errors gracefully
    if (error.message?.includes('Unique constraint failed')) {
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
        console.error('Error fetching wallet after constraint error:', fetchError);
      }
    }

    res.status(500).json({ error: 'Failed to get wallet', message: error.message });
  }
};


