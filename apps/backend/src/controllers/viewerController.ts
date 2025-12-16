import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { activateMemeSchema } from '../shared/index.js';
import { getActivePromotion, calculatePriceWithDiscount } from '../utils/promotions.js';
import { Server } from 'socket.io';

export const viewerController = {
  getChannelBySlug: async (req: any, res: Response) => {
    const { slug } = req.params;

    const channel = await prisma.channel.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        name: true,
        coinPerPointRatio: true,
        createdAt: true,
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
      primaryColor: (channel as any).primaryColor || null,
      secondaryColor: (channel as any).secondaryColor || null,
      accentColor: (channel as any).accentColor || null,
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

  searchMemes: async (req: any, res: Response) => {
    const {
      q, // search query
      tags, // comma-separated tag names
      channelId,
      channelSlug,
      minPrice,
      maxPrice,
      sortBy = 'createdAt', // createdAt, priceCoins, popularity
      sortOrder = 'desc', // asc, desc
      limit = 50,
      offset = 0,
    } = req.query;

    // Determine channel
    let targetChannelId: string | null = null;
    if (channelSlug) {
      const channel = await prisma.channel.findUnique({
        where: { slug: channelSlug as string },
        select: { id: true },
      });
      if (channel) {
        targetChannelId = channel.id;
      }
    } else if (channelId) {
      targetChannelId = channelId as string;
    }

    // Build where clause
    const where: any = {
      status: 'approved',
    };

    if (targetChannelId) {
      where.channelId = targetChannelId;
    }

    // Search query - search in title (case-insensitive, partial match)
    if (q) {
      where.title = {
        contains: q as string,
        mode: 'insensitive',
      };
    }

    // Price filters
    if (minPrice) {
      where.priceCoins = {
        ...where.priceCoins,
        gte: parseInt(minPrice as string, 10),
      };
    }
    if (maxPrice) {
      where.priceCoins = {
        ...where.priceCoins,
        lte: parseInt(maxPrice as string, 10),
      };
    }

    // Tag filters
    if (tags) {
      const tagNames = (tags as string).split(',').map((t) => t.trim().toLowerCase());
      const tagRecords = await prisma.tag.findMany({
        where: {
          name: {
            in: tagNames,
          },
        },
      });
      const tagIds = tagRecords.map((t) => t.id);
      if (tagIds.length > 0) {
        where.tags = {
          some: {
            tagId: {
              in: tagIds,
            },
          },
        };
      } else {
        // If no tags found, return empty result
        return res.json([]);
      }
    }

    // Build orderBy
    let orderBy: any = {};
    if (sortBy === 'priceCoins') {
      orderBy.priceCoins = sortOrder;
    } else if (sortBy === 'popularity') {
      // Popularity = number of activations
      // We'll need to join with activations and count
      // For now, use createdAt as fallback
      orderBy.createdAt = sortOrder;
    } else {
      orderBy.createdAt = sortOrder;
    }

    // Execute query
    const memes = await prisma.meme.findMany({
      where,
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
        _count: {
          select: {
            activations: true,
          },
        },
      },
      orderBy,
      take: parseInt(limit as string, 10),
      skip: parseInt(offset as string, 10),
    });

    // If sorting by popularity, sort in memory
    if (sortBy === 'popularity') {
      memes.sort((a, b) => {
        const countA = a._count.activations;
        const countB = b._count.activations;
        if (sortOrder === 'asc') {
          return countA - countB;
        }
        return countB - countA;
      });
    }

    res.json(memes);
  },

  getMemeStats: async (req: any, res: Response) => {
    const {
      period = 'month', // day, week, month, year, all
      limit = 10,
      channelId,
      channelSlug,
    } = req.query;

    // Determine channel
    let targetChannelId: string | null = null;
    if (channelSlug) {
      const channel = await prisma.channel.findUnique({
        where: { slug: channelSlug as string },
        select: { id: true },
      });
      if (channel) {
        targetChannelId = channel.id;
      }
    } else if (channelId) {
      targetChannelId = channelId as string;
    }

    // Calculate date range
    const now = new Date();
    let startDate: Date;
    switch (period) {
      case 'day':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(0); // All time
    }

    // Build where clause
    const where: any = {
      status: 'done', // Only count completed activations
      createdAt: {
        gte: startDate,
      },
    };

    if (targetChannelId) {
      where.channelId = targetChannelId;
    }

    // Get meme statistics
    const activations = await prisma.memeActivation.groupBy({
      by: ['memeId'],
      where,
      _count: {
        id: true,
      },
      _sum: {
        coinsSpent: true,
      },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
      take: parseInt(limit as string, 10),
    });

    // Get meme details
    const memeIds = activations.map((a) => a.memeId);
    const memes = await prisma.meme.findMany({
      where: {
        id: {
          in: memeIds,
        },
      },
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
      },
    });

    // Combine data
    const stats = activations.map((activation) => {
      const meme = memes.find((m) => m.id === activation.memeId);
      return {
        meme: meme
          ? {
              id: meme.id,
              title: meme.title,
              priceCoins: meme.priceCoins,
              tags: meme.tags,
            }
          : null,
        activationsCount: activation._count.id,
        totalCoinsSpent: activation._sum.coinsSpent || 0,
      };
    });

    res.json({
      period,
      startDate,
      endDate: now,
      stats,
    });
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

        // Check for active promotion
        const promotion = await getActivePromotion(meme.channelId);
        const finalPrice = promotion
          ? calculatePriceWithDiscount(meme.priceCoins, promotion.discountPercent)
          : meme.priceCoins;

        if (wallet.balance < finalPrice) {
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
              decrement: finalPrice,
            },
          },
        });

        const activation = await tx.memeActivation.create({
          data: {
            channelId: meme.channelId,
            userId: req.userId!,
            memeId: meme.id,
            coinsSpent: finalPrice,
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

      // Get promotion info for response
      const promotion = await getActivePromotion(result.meme.channelId);
      const originalPrice = result.meme.priceCoins;
      const finalPrice = promotion
        ? calculatePriceWithDiscount(originalPrice, promotion.discountPercent)
        : originalPrice;

      res.json({
        activation: result.activation,
        wallet: result.wallet,
        originalPrice,
        finalPrice,
        discountApplied: promotion ? promotion.discountPercent : 0,
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


