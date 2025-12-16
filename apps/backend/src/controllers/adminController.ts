import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { approveSubmissionSchema, rejectSubmissionSchema, updateMemeSchema, updateChannelSettingsSchema } from '../shared/index.js';
import { getOrCreateTags } from '../utils/tags.js';
import { calculateFileHash, findOrCreateFileHash, getFileStats, getFileHashByPath, incrementFileHashReference, downloadAndDeduplicateFile } from '../utils/fileHash.js';
import { getVideoMetadata } from '../utils/videoValidator.js';
import fs from 'fs';
import path from 'path';

const MAX_DURATION_SECONDS = 15; // 15 seconds max

export const adminController = {
  getSubmissions: async (req: AuthRequest, res: Response) => {
    const status = req.query.status as string | undefined;
    const channelId = req.channelId;

    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID required' });
    }

    try {
      // Try to get submissions with tags first
      const submissionsPromise = prisma.memeSubmission.findMany({
        where: {
          channelId,
          ...(status ? { status } : {}),
        },
        include: {
          tags: {
            include: {
              tag: true,
            },
          },
          submitter: {
            select: {
              id: true,
              displayName: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Add timeout protection
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Database query timeout')), 10000); // 10 seconds
      });

      let submissions;
      try {
        submissions = await Promise.race([submissionsPromise, timeoutPromise]);
      } catch (error: any) {
        // If error is about MemeSubmissionTag table, retry without tags
        if (error?.code === 'P2021' && error?.meta?.table === 'public.MemeSubmissionTag') {
          console.warn('MemeSubmissionTag table not found, fetching submissions without tags');
          submissions = await prisma.memeSubmission.findMany({
            where: {
              channelId,
              ...(status ? { status } : {}),
            },
            include: {
              submitter: {
                select: {
                  id: true,
                  displayName: true,
                },
              },
            },
            orderBy: {
              createdAt: 'desc',
            },
          });
          // Add empty tags array to match expected structure
          submissions = submissions.map((s: any) => ({ ...s, tags: [] }));
        } else if (error?.message === 'Database query timeout') {
          return res.status(408).json({ 
            error: 'Request timeout', 
            message: 'Database query timed out. Please try again.' 
          });
        } else {
          throw error;
        }
      }

      res.json(submissions);
    } catch (error: any) {
      console.error('Error in getSubmissions:', error);
      if (!res.headersSent) {
        return res.status(500).json({
          error: 'Internal server error',
          message: 'Failed to fetch submissions',
          details: process.env.NODE_ENV === 'development' ? error?.message : undefined,
        });
      }
    }
  },

  approveSubmission: async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const channelId = req.channelId;

    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID required' });
    }

    try {
      const body = approveSubmissionSchema.parse(req.body);

      const result = await prisma.$transaction(async (tx) => {
        // Try to get submission with tags first
        let submission: any;
        try {
          submission = await tx.memeSubmission.findUnique({
            where: { id },
            include: {
              tags: {
                include: {
                  tag: true,
                },
              },
            },
          });
        } catch (error: any) {
          // If error is about MemeSubmissionTag table, retry without tags
          if (error?.code === 'P2021' && error?.meta?.table === 'public.MemeSubmissionTag') {
            console.warn('MemeSubmissionTag table not found, fetching submission without tags');
            submission = await tx.memeSubmission.findUnique({
              where: { id },
            });
            // Add empty tags array to match expected structure
            if (submission) {
              submission.tags = [];
            }
          } else {
            throw error;
          }
        }

        if (!submission || submission.channelId !== channelId) {
          throw new Error('Submission not found');
        }

        if (submission.status !== 'pending') {
          throw new Error('Submission already processed');
        }

        // Determine fileUrl: handle deduplication for both uploaded and imported files
        let finalFileUrl: string;
        let fileHash: string | null = null;
        
        if (submission.sourceUrl) {
          // Imported meme - download, calculate hash, and perform deduplication
          try {
            const result = await downloadAndDeduplicateFile(submission.sourceUrl);
            finalFileUrl = result.filePath;
            fileHash = result.fileHash;
            console.log(`Imported file deduplication: ${result.isNew ? 'new file' : 'duplicate found'}, hash: ${fileHash}`);
          } catch (error: any) {
            console.error('Failed to download and deduplicate imported file:', error.message);
            // Fallback to using sourceUrl directly if download fails
            finalFileUrl = submission.sourceUrl;
            console.warn('Using sourceUrl directly as fallback');
          }
        } else {
          // Uploaded file - check if already deduplicated or perform deduplication
          const filePath = path.join(process.cwd(), submission.fileUrlTemp);
          
          // Check if file already exists in FileHash (was deduplicated during upload)
          const existingHash = await getFileHashByPath(submission.fileUrlTemp);
          
          if (existingHash) {
            // File was already deduplicated - use existing path and increment reference
            finalFileUrl = submission.fileUrlTemp;
            fileHash = existingHash;
            await incrementFileHashReference(existingHash);
          } else if (fs.existsSync(filePath)) {
            // File exists but not in FileHash - calculate hash and deduplicate
            try {
              const hash = await calculateFileHash(filePath);
              const stats = await getFileStats(filePath);
              const result = await findOrCreateFileHash(filePath, hash, stats.mimeType, stats.size);
              finalFileUrl = result.filePath;
              fileHash = hash;
              console.log(`File deduplication on approve: ${result.isNew ? 'new file' : 'duplicate found'}, hash: ${hash}`);
            } catch (error: any) {
              console.error('File hash calculation failed during approve:', error);
              // Fallback to original path
              finalFileUrl = submission.fileUrlTemp;
            }
          } else {
            throw new Error('Uploaded file not found');
          }
        }

        // Get tags: use tags from body if provided, otherwise use tags from submission
        // Handle case when tags table doesn't exist
        const tagNames = body.tags && body.tags.length > 0
          ? body.tags
          : (submission.tags && Array.isArray(submission.tags) && submission.tags.length > 0
              ? submission.tags.map((st: any) => st.tag?.name || st.tag).filter(Boolean)
              : []);
        
        const tagIds = tagNames.length > 0 ? await getOrCreateTags(tagNames) : [];

        // Determine duration: try to get from video if uploaded, otherwise use standard/default
        let durationMs = body.durationMs || 15000; // Default: 15 seconds (15000ms)
        const STANDARD_DURATION_MS = 15000; // 15 seconds max
        const STANDARD_PRICE_COINS = 100; // Standard price: 100 coins
        
        // For uploaded files, try to get actual video duration (with timeout protection)
        if (!submission.sourceUrl && finalFileUrl && !finalFileUrl.startsWith('http')) {
          try {
            const filePath = path.join(process.cwd(), finalFileUrl);
            if (fs.existsSync(filePath)) {
              // Try to get video metadata with timeout
              const metadataPromise = getVideoMetadata(filePath);
              const timeoutPromise = new Promise<{ duration: number }>((resolve) => {
                setTimeout(() => {
                  console.warn('Video metadata timeout, using standard duration');
                  resolve({ duration: 0 });
                }, 5000); // 5 second timeout
              });
              
              const metadata = await Promise.race([metadataPromise, timeoutPromise]);
              
              if (metadata && metadata.duration > 0) {
                // Convert seconds to milliseconds and cap at 15 seconds
                const durationSeconds = Math.min(metadata.duration, MAX_DURATION_SECONDS);
                durationMs = Math.round(durationSeconds * 1000);
              } else {
                // Use standard duration if metadata unavailable
                durationMs = STANDARD_DURATION_MS;
              }
            }
          } catch (error: any) {
            console.warn('Failed to get video duration, using standard:', error.message);
            durationMs = STANDARD_DURATION_MS;
          }
        } else {
          // For imported memes, use standard duration
          durationMs = STANDARD_DURATION_MS;
        }

        // Use standard price if not provided
        const priceCoins = body.priceCoins || STANDARD_PRICE_COINS;

        // Update submission
        await tx.memeSubmission.update({
          where: { id },
          data: {
            status: 'approved',
          },
        });

        // Create meme with tags (only if we have tagIds)
        const memeData: any = {
          channelId: submission.channelId,
          title: submission.title,
          type: submission.type,
          fileUrl: finalFileUrl,
          fileHash: fileHash, // Store hash for deduplication tracking
          durationMs,
          priceCoins,
          status: 'approved',
          createdByUserId: submission.submitterUserId,
          approvedByUserId: req.userId!,
        };

        // Only add tags if we have tagIds
        if (tagIds.length > 0) {
          memeData.tags = {
            create: tagIds.map((tagId) => ({
              tagId,
            })),
          };
        }

        const meme = await tx.meme.create({
          data: memeData,
          include: tagIds.length > 0 ? {
            tags: {
              include: {
                tag: true,
              },
            },
          } : undefined,
        });

        return meme;
      });

      res.json(result);
    } catch (error: any) {
      if (error.message === 'Submission not found' || error.message === 'Submission already processed') {
        return res.status(400).json({ error: error.message });
      }
      throw error;
    }
  },

  rejectSubmission: async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const channelId = req.channelId;

    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID required' });
    }

    try {
      const body = rejectSubmissionSchema.parse(req.body);

      const submission = await prisma.memeSubmission.findUnique({
        where: { id },
      });

      if (!submission || submission.channelId !== channelId) {
        return res.status(404).json({ error: 'Submission not found' });
      }

      if (submission.status !== 'pending') {
        return res.status(400).json({ error: 'Submission already processed' });
      }

      const updated = await prisma.memeSubmission.update({
        where: { id },
        data: {
          status: 'rejected',
          moderatorNotes: body.moderatorNotes || null,
        },
      });

      // Don't delete file on reject - keep it for potential future use

      res.json(updated);
    } catch (error) {
      throw error;
    }
  },

  getMemes: async (req: AuthRequest, res: Response) => {
    const channelId = req.channelId;

    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID required' });
    }

    const memes = await prisma.meme.findMany({
      where: {
        channelId,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            displayName: true,
            channel: {
              select: {
                slug: true,
              },
            },
          },
        },
        approvedBy: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(memes);
  },

  updateMeme: async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const channelId = req.channelId;

    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID required' });
    }

    try {
      const body = updateMemeSchema.parse(req.body);

      const meme = await prisma.meme.findUnique({
        where: { id },
      });

      if (!meme || meme.channelId !== channelId) {
        return res.status(404).json({ error: 'Meme not found' });
      }

      const updated = await prisma.meme.update({
        where: { id },
        data: body,
      });

      res.json(updated);
    } catch (error) {
      throw error;
    }
  },

  updateChannelSettings: async (req: AuthRequest, res: Response) => {
    const channelId = req.channelId;

    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID required' });
    }

    try {
      const body = updateChannelSettingsSchema.parse(req.body);

      const channel = await prisma.channel.update({
        where: { id: channelId },
        data: body,
      });

      res.json(channel);
    } catch (error) {
      throw error;
    }
  },

  // Admin wallet management
  getAllWallets: async (req: AuthRequest, res: Response) => {
    // Only admins can access this
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
    });

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const wallets = await prisma.wallet.findMany({
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            twitchUserId: true,
          },
        },
        channel: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    res.json(wallets);
  },

  adjustWallet: async (req: AuthRequest, res: Response) => {
    // Only admins can access this
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
    });

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { userId, channelId } = req.params;
    const { amount } = req.body;

    if (!userId || !channelId || typeof amount !== 'number') {
      return res.status(400).json({ error: 'Invalid parameters' });
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Get current wallet
        const wallet = await tx.wallet.findUnique({
          where: {
            userId_channelId: {
              userId,
              channelId,
            },
          },
        });

        if (!wallet) {
          throw new Error('Wallet not found');
        }

        // Calculate new balance
        const newBalance = wallet.balance + amount;

        // Validate balance doesn't go negative
        if (newBalance < 0) {
          throw new Error('Balance cannot be negative');
        }

        // Update wallet
        const updatedWallet = await tx.wallet.update({
          where: {
            userId_channelId: {
              userId,
              channelId,
            },
          },
          data: {
            balance: newBalance,
          },
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
              },
            },
            channel: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });

        // Log action in audit log
        await tx.auditLog.create({
          data: {
            actorId: req.userId!,
            channelId,
            action: 'wallet_adjust',
            payloadJson: JSON.stringify({
              userId,
              channelId,
              amount,
              previousBalance: wallet.balance,
              newBalance,
            }),
          },
        });

        return updatedWallet;
      });

      res.json(result);
    } catch (error: any) {
      if (error.message === 'Wallet not found' || error.message === 'Balance cannot be negative') {
        return res.status(400).json({ error: error.message });
      }
      throw error;
    }
  },

  // Promotion management
  getPromotions: async (req: AuthRequest, res: Response) => {
    const channelId = req.channelId;
    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID required' });
    }

    const promotions = await prisma.promotion.findMany({
      where: { channelId },
      orderBy: { createdAt: 'desc' },
    });

    res.json(promotions);
  },

  createPromotion: async (req: AuthRequest, res: Response) => {
    const channelId = req.channelId;
    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID required' });
    }

    try {
      const { createPromotionSchema } = await import('../shared/index.js');
      const body = createPromotionSchema.parse(req.body);

      // Validate dates
      const startDate = new Date(body.startDate);
      const endDate = new Date(body.endDate);
      if (endDate <= startDate) {
        return res.status(400).json({ error: 'End date must be after start date' });
      }

      const promotion = await prisma.promotion.create({
        data: {
          channelId,
          name: body.name,
          discountPercent: body.discountPercent,
          startDate,
          endDate,
        },
      });

      res.status(201).json(promotion);
    } catch (error) {
      throw error;
    }
  },

  updatePromotion: async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const channelId = req.channelId;
    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID required' });
    }

    try {
      const { updatePromotionSchema } = await import('../shared/index.js');
      const body = updatePromotionSchema.parse(req.body);

      // Check promotion belongs to channel
      const promotion = await prisma.promotion.findUnique({
        where: { id },
      });

      if (!promotion || promotion.channelId !== channelId) {
        return res.status(404).json({ error: 'Promotion not found' });
      }

      const updateData: any = {};
      if (body.name !== undefined) updateData.name = body.name;
      if (body.discountPercent !== undefined) updateData.discountPercent = body.discountPercent;
      if (body.startDate !== undefined) updateData.startDate = new Date(body.startDate);
      if (body.endDate !== undefined) updateData.endDate = new Date(body.endDate);
      if (body.isActive !== undefined) updateData.isActive = body.isActive;

      // Validate dates if both are provided
      if (updateData.startDate && updateData.endDate && updateData.endDate <= updateData.startDate) {
        return res.status(400).json({ error: 'End date must be after start date' });
      }

      const updated = await prisma.promotion.update({
        where: { id },
        data: updateData,
      });

      res.json(updated);
    } catch (error) {
      throw error;
    }
  },

  deletePromotion: async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const channelId = req.channelId;
    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID required' });
    }

    try {
      const promotion = await prisma.promotion.findUnique({
        where: { id },
      });

      if (!promotion || promotion.channelId !== channelId) {
        return res.status(404).json({ error: 'Promotion not found' });
      }

      await prisma.promotion.delete({
        where: { id },
      });

      res.json({ success: true });
    } catch (error) {
      throw error;
    }
  },

  // Channel statistics
  getChannelStats: async (req: AuthRequest, res: Response) => {
    const channelId = req.channelId;
    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID required' });
    }

    try {
      // Get user spending stats
      const userSpending = await prisma.memeActivation.groupBy({
        by: ['userId'],
        where: {
          channelId,
          status: 'done',
        },
        _sum: {
          coinsSpent: true,
        },
        _count: {
          id: true,
        },
        orderBy: {
          _sum: {
            coinsSpent: 'desc',
          },
        },
        take: 20,
      });

      // Get user details
      const userIds = userSpending.map((s) => s.userId);
      const users = await prisma.user.findMany({
        where: {
          id: {
            in: userIds,
          },
        },
        select: {
          id: true,
          displayName: true,
        },
      });

      // Get meme popularity stats
      const memeStats = await prisma.memeActivation.groupBy({
        by: ['memeId'],
        where: {
          channelId,
          status: 'done',
        },
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
        take: 20,
      });

      const memeIds = memeStats.map((s) => s.memeId);
      const memes = await prisma.meme.findMany({
        where: {
          id: {
            in: memeIds,
          },
        },
        select: {
          id: true,
          title: true,
          priceCoins: true,
        },
      });

      // Overall stats
      const totalActivations = await prisma.memeActivation.count({
        where: {
          channelId,
          status: 'done',
        },
      });

      const totalCoinsSpent = await prisma.memeActivation.aggregate({
        where: {
          channelId,
          status: 'done',
        },
        _sum: {
          coinsSpent: true,
        },
      });

      const totalMemes = await prisma.meme.count({
        where: {
          channelId,
          status: 'approved',
        },
      });

      res.json({
        userSpending: userSpending.map((s) => ({
          user: users.find((u) => u.id === s.userId) || { id: s.userId, displayName: 'Unknown' },
          totalCoinsSpent: s._sum.coinsSpent || 0,
          activationsCount: s._count.id,
        })),
        memePopularity: memeStats.map((s) => ({
          meme: memes.find((m) => m.id === s.memeId) || null,
          activationsCount: s._count.id,
          totalCoinsSpent: s._sum.coinsSpent || 0,
        })),
        overall: {
          totalActivations,
          totalCoinsSpent: totalCoinsSpent._sum.coinsSpent || 0,
          totalMemes,
        },
      });
    } catch (error) {
      throw error;
    }
  },
};


