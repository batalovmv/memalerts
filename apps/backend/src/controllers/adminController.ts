import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { approveSubmissionSchema, rejectSubmissionSchema, updateMemeSchema, updateChannelSettingsSchema } from '../shared/index.js';
import { getOrCreateTags } from '../utils/tags.js';
import { calculateFileHash, findOrCreateFileHash, getFileStats, getFileHashByPath, incrementFileHashReference, downloadAndDeduplicateFile } from '../utils/fileHash.js';
import { validatePathWithinDirectory } from '../utils/pathSecurity.js';
import { logAdminAction } from '../utils/auditLogger.js';
import { ZodError } from 'zod';
import { PrismaClientKnownRequestError, PrismaClientUnknownRequestError } from '@prisma/client/runtime/library';
import fs from 'fs';
import path from 'path';
import {
  createChannelReward,
  updateChannelReward,
  deleteChannelReward,
  getChannelRewards,
  createEventSubSubscription,
  getEventSubSubscriptions,
} from '../utils/twitchApi.js';

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

      // Get submission first to check if it's imported (has sourceUrl)
      let submissionForBackground: any;
      try {
        submissionForBackground = await prisma.memeSubmission.findUnique({
          where: { id },
          select: { sourceUrl: true },
        });
      } catch (error) {
        // Ignore, will check in transaction
      }

      const result = await prisma.$transaction(async (tx) => {
        // Get submission WITHOUT tags to avoid transaction abort if MemeSubmissionTag table doesn't exist
        // The table may not exist on production, so we fetch without tags from the start
        let submission: any;
        try {
          submission = await tx.memeSubmission.findUnique({
            where: { id },
          });
          // Add empty tags array to match expected structure
          if (submission) {
            submission.tags = [];
          }
        } catch (error: any) {
          console.error('Error fetching submission:', error);
          throw new Error('Failed to fetch submission');
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
          // Imported meme - use sourceUrl temporarily, download will happen in background
          // This prevents timeout issues - we approve immediately and download async
          finalFileUrl = submission.sourceUrl;
        } else {
          // Uploaded file - check if already deduplicated or perform deduplication
          // Validate path to prevent path traversal attacks
          let filePath: string;
          try {
            const uploadsDir = path.join(process.cwd(), 'uploads');
            filePath = validatePathWithinDirectory(submission.fileUrlTemp, uploadsDir);
          } catch (pathError: any) {
            console.error(`Path validation failed for submission.fileUrlTemp: ${submission.fileUrlTemp}`, pathError.message);
            throw new Error('Invalid file path: File path contains invalid characters or path traversal attempt');
          }
          
          // Check if file already exists in FileHash (was deduplicated during upload)
          const existingHash = await getFileHashByPath(submission.fileUrlTemp);
          
          if (existingHash) {
            // File was already deduplicated - use existing path and increment reference
            finalFileUrl = submission.fileUrlTemp;
            fileHash = existingHash;
            await incrementFileHashReference(existingHash);
          } else if (fs.existsSync(filePath)) {
            // File exists but not in FileHash - calculate hash and deduplicate with timeout
            try {
              // Add timeout for hash calculation to prevent hanging
              const hashPromise = calculateFileHash(filePath);
              const hashTimeout = new Promise<string>((_, reject) => {
                setTimeout(() => reject(new Error('Hash calculation timeout')), 10000); // 10 second timeout
              });
              
              const hash = await Promise.race([hashPromise, hashTimeout]);
              const stats = await getFileStats(filePath);
              const result = await findOrCreateFileHash(filePath, hash, stats.mimeType, stats.size);
              finalFileUrl = result.filePath;
              fileHash = hash;
              console.log(`File deduplication on approve: ${result.isNew ? 'new file' : 'duplicate found'}, hash: ${hash}`);
            } catch (error: any) {
              console.error('File hash calculation failed during approve:', error.message);
              // Fallback to original path - don't fail the approval
              finalFileUrl = submission.fileUrlTemp;
              fileHash = null;
            }
          } else {
            throw new Error('Uploaded file not found');
          }
        }

        // Get tags: use tags from body if provided, otherwise use tags from submission
        // Handle case when tags table doesn't exist - with timeout protection
        const tagNames = body.tags && body.tags.length > 0
          ? body.tags
          : (submission.tags && Array.isArray(submission.tags) && submission.tags.length > 0
              ? submission.tags.map((st: any) => st.tag?.name || st.tag).filter(Boolean)
              : []);
        
        let tagIds: string[] = [];
        if (tagNames.length > 0) {
          try {
            const tagsPromise = getOrCreateTags(tagNames);
            const tagsTimeout = new Promise<string[]>((resolve) => {
              setTimeout(() => {
                console.warn('Tags creation timeout, proceeding without tags');
                resolve([]);
              }, 3000); // 3 second timeout for tags
            });
            tagIds = await Promise.race([tagsPromise, tagsTimeout]);
          } catch (error: any) {
            console.warn('Error creating tags, proceeding without tags:', error.message);
            tagIds = [];
          }
        }

        // Use standard values - skip video metadata to avoid hanging
        const STANDARD_DURATION_MS = 15000; // 15 seconds (15000ms)
        const STANDARD_PRICE_COINS = 100; // Standard price: 100 coins
        
        // Always use standard duration - skip video metadata to prevent hanging
        // Video duration validation happens on upload, so we can trust the file is valid
        const durationMs = body.durationMs || STANDARD_DURATION_MS;
        const priceCoins = body.priceCoins || STANDARD_PRICE_COINS;

        // Update submission
        try {
          await tx.memeSubmission.update({
            where: { id },
            data: {
              status: 'approved',
            },
          });
        } catch (error: any) {
          console.error('Error updating submission status:', error);
          throw new Error('Failed to update submission status');
        }

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

        try {
          const meme = await tx.meme.create({
            data: memeData,
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
              ...(tagIds.length > 0 ? {
                tags: {
                  include: {
                    tag: true,
                  },
                },
              } : {}),
            },
          });

          return meme;
        } catch (error: any) {
          console.error('Error creating meme:', error);
          // Check if it's a constraint violation or other Prisma error
          if (error instanceof PrismaClientKnownRequestError) {
            if (error.code === 'P2002') {
              throw new Error('Meme with this data already exists');
            }
            if (error.code === 'P2003') {
              throw new Error('Invalid reference in meme data');
            }
          }
          throw new Error('Failed to create meme');
        }
      }, {
        timeout: 30000, // 30 second timeout for transaction
        maxWait: 10000, // 10 second max wait for transaction to start
      });

      // If this is an imported meme, start background download and update
      if (submissionForBackground?.sourceUrl && result && 'id' in result) {
        const memeId = result.id;
        const sourceUrl = submissionForBackground.sourceUrl;
        
        // Start background download and deduplication (don't await - fire and forget)
        // This will update the meme's fileUrl once download completes
        downloadAndDeduplicateFile(sourceUrl).then((downloadResult) => {
          // Update meme with local file path after download completes
          prisma.meme.update({
            where: { id: memeId },
            data: {
              fileUrl: downloadResult.filePath,
              fileHash: downloadResult.fileHash,
            },
          }).then(() => {
            console.log(`Background download completed for meme ${memeId}: ${downloadResult.isNew ? 'new file' : 'duplicate found'}, hash: ${downloadResult.fileHash}`);
          }).catch((err) => {
            console.error(`Failed to update meme ${memeId} after background download:`, err);
          });
        }).catch((error: any) => {
          console.error(`Background download failed for meme ${memeId}:`, error.message);
          // File will continue using sourceUrl - that's okay, it will work
        });
      }

      res.json(result);
    } catch (error: any) {
      console.error('Error in approveSubmission:', error);

      // Don't send response if headers already sent
      if (res.headersSent) {
        console.error('Error occurred after response was sent in approveSubmission');
        return;
      }

      // Handle validation errors (ZodError)
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Validation error',
          message: 'Validation failed',
          details: error.errors,
        });
      }

      // Handle Prisma errors
      if (error instanceof PrismaClientKnownRequestError || error instanceof PrismaClientUnknownRequestError) {
        console.error('Prisma error in approveSubmission:', error.message);
        
        // Handle transaction aborted error (25P02)
        if (error.message?.includes('current transaction is aborted') || error.message?.includes('25P02')) {
          return res.status(500).json({
            error: 'Database transaction error',
            message: 'Transaction was aborted. Please try again.',
          });
        }

        // Handle other Prisma errors
        return res.status(500).json({
          error: 'Database error',
          message: 'An error occurred while processing the request. Please try again.',
        });
      }

      // Handle specific error messages
      if (error.message === 'Submission not found' || error.message === 'Submission already processed') {
        return res.status(400).json({ error: error.message });
      }

      if (error.message === 'Uploaded file not found') {
        return res.status(404).json({ error: error.message });
      }

      // Handle file operation errors
      if (error.message?.includes('Hash calculation timeout') || error.message?.includes('file')) {
        console.error('File operation error in approveSubmission:', error.message);
        return res.status(500).json({
          error: 'File operation error',
          message: 'An error occurred while processing the file. Please try again.',
        });
      }

      // Handle all other errors
      return res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred while processing the request',
      });
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

      // Log admin action
      await logAdminAction(
        'reject_submission',
        req.userId!,
        channelId,
        id,
        {
          submissionId: id,
          notes: body.moderatorNotes || null,
        },
        true,
        req
      );

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
      });

      res.json(updated);
    } catch (error) {
      throw error;
    }
  },

  updateChannelSettings: async (req: AuthRequest, res: Response) => {
    const channelId = req.channelId;
    const userId = req.userId;

    if (!channelId || !userId) {
      return res.status(400).json({ error: 'Channel ID and User ID required' });
    }

    try {
      const body = updateChannelSettingsSchema.parse(req.body);

      // Get channel and user info
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
      });

      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      // Handle reward enable/disable
      let coinIconUrl: string | null = null;
      
      if (body.rewardEnabled !== undefined) {
        if (body.rewardEnabled) {
          // Enable reward - create or update in Twitch
          if (!body.rewardCost || !body.rewardCoins) {
            return res.status(400).json({ error: 'Reward cost and coins are required when enabling reward' });
          }

          // Check if user has access token
          const userWithToken = await prisma.user.findUnique({
            where: { id: userId },
            select: { twitchAccessToken: true, twitchRefreshToken: true },
          });

          if (!userWithToken || !userWithToken.twitchAccessToken) {
            return res.status(401).json({ 
              error: 'Twitch access token not found. Please log out and log in again to refresh your authorization.',
              requiresReauth: true 
            });
          }

          // First, try to get existing rewards to see if we already have one
          let existingRewardId: string | null = null;
          let oldRewardsToDelete: string[] = [];
          try {
            const rewards = await getChannelRewards(userId, channel.twitchChannelId);
            
            if (rewards?.data) {
              // Check if we have a stored reward ID that still exists
              if (channel.rewardIdForCoins) {
                const storedReward = rewards.data.find((r: any) => r.id === channel.rewardIdForCoins);
                if (storedReward) {
                  existingRewardId = channel.rewardIdForCoins;
                }
              }
              
              // If no stored reward found, try to find a reward with matching title pattern
              if (!existingRewardId) {
                const matchingReward = rewards.data.find((r: any) => 
                  r.title?.includes('Coins') || r.title?.includes('монет') || r.title?.includes('тест')
                );
                if (matchingReward) {
                  existingRewardId = matchingReward.id;
                }
              }
              
              // Find old rewards to delete (rewards with "Coins" in title that are not the current one)
              oldRewardsToDelete = rewards.data
                .filter((r: any) => 
                  r.id !== existingRewardId && 
                  (r.title?.includes('Coins') || r.title?.includes('Get') || r.title?.includes('монет'))
                )
                .map((r: any) => r.id);
            }
          } catch (error: any) {
            console.error('Error fetching rewards:', error);
            // Continue with create/update logic
          }
          
          // Delete old rewards
          for (const oldRewardId of oldRewardsToDelete) {
            try {
              await deleteChannelReward(userId, channel.twitchChannelId, oldRewardId);
            } catch (error: any) {
              console.error('Error deleting old reward:', error);
              // Continue even if deletion fails
            }
          }
          
          if (existingRewardId) {
            // Update existing reward
            try {
              await updateChannelReward(
                userId,
                channel.twitchChannelId,
                existingRewardId,
                {
                  title: body.rewardTitle || `Get ${body.rewardCoins} Coins`,
                  cost: body.rewardCost,
                  is_enabled: true,
                  prompt: `Redeem ${body.rewardCost} channel points to get ${body.rewardCoins} coins!`,
                }
              );
              body.rewardIdForCoins = existingRewardId;
              
              // Fetch reward details to get image URL (wait a bit for Twitch to process)
              try {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second for Twitch to process
                const rewardDetails = await getChannelRewards(userId, channel.twitchChannelId, existingRewardId);
                if (rewardDetails?.data?.[0]?.image?.url_1x || rewardDetails?.data?.[0]?.image?.url_2x || rewardDetails?.data?.[0]?.image?.url_4x) {
                  coinIconUrl = rewardDetails.data[0].image.url_1x || rewardDetails.data[0].image.url_2x || rewardDetails.data[0].image.url_4x;
                }
              } catch (error) {
                console.error('Error fetching reward details for icon:', error);
              }
            } catch (error: any) {
              console.error('Error updating reward:', error);
              // If update fails, create new one
              const rewardResponse = await createChannelReward(
                userId,
                channel.twitchChannelId,
                body.rewardTitle || `Get ${body.rewardCoins} Coins`,
                body.rewardCost,
                `Redeem ${body.rewardCost} channel points to get ${body.rewardCoins} coins!`
              );
              body.rewardIdForCoins = rewardResponse.data[0].id;
              
              // Extract image URL from reward response or fetch details
              if (rewardResponse?.data?.[0]?.image?.url_1x || rewardResponse?.data?.[0]?.image?.url_2x || rewardResponse?.data?.[0]?.image?.url_4x) {
                coinIconUrl = rewardResponse.data[0].image.url_1x || rewardResponse.data[0].image.url_2x || rewardResponse.data[0].image.url_4x;
              } else {
                // If image not in response, fetch reward details
                try {
                  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second for Twitch to process
                  const rewardDetails = await getChannelRewards(userId, channel.twitchChannelId, body.rewardIdForCoins ?? undefined);
                  if (rewardDetails?.data?.[0]?.image?.url_1x || rewardDetails?.data?.[0]?.image?.url_2x || rewardDetails?.data?.[0]?.image?.url_4x) {
                    coinIconUrl = rewardDetails.data[0].image.url_1x || rewardDetails.data[0].image.url_2x || rewardDetails.data[0].image.url_4x;
                  }
                } catch (error) {
                  console.error('Error fetching reward details for icon:', error);
                }
              }
            }
          } else {
            // Create new reward
            const rewardResponse = await createChannelReward(
              userId,
              channel.twitchChannelId,
              body.rewardTitle || `Get ${body.rewardCoins} Coins`,
              body.rewardCost,
              `Redeem ${body.rewardCost} channel points to get ${body.rewardCoins} coins!`
            );
            body.rewardIdForCoins = rewardResponse.data[0].id;
            
            // Extract image URL from reward response or fetch details
            if (rewardResponse?.data?.[0]?.image?.url_1x || rewardResponse?.data?.[0]?.image?.url_2x || rewardResponse?.data?.[0]?.image?.url_4x) {
              coinIconUrl = rewardResponse.data[0].image.url_1x || rewardResponse.data[0].image.url_2x || rewardResponse.data[0].image.url_4x;
            } else {
              // If image not in response, fetch reward details
              try {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second for Twitch to process
                const rewardDetails = await getChannelRewards(userId, channel.twitchChannelId, body.rewardIdForCoins ?? undefined);
                if (rewardDetails?.data?.[0]?.image?.url_1x || rewardDetails?.data?.[0]?.image?.url_2x || rewardDetails?.data?.[0]?.image?.url_4x) {
                  coinIconUrl = rewardDetails.data[0].image.url_1x || rewardDetails.data[0].image.url_2x || rewardDetails.data[0].image.url_4x;
                }
              } catch (error) {
                console.error('Error fetching reward details for icon:', error);
              }
            }
          }
          
          // Create EventSub subscription if it doesn't exist
          try {
            // Use API URL (backend), not frontend URL
            // For production, use https://twitchmemes.ru, for dev use localhost
            const apiUrl = process.env.NODE_ENV === 'production' 
              ? 'https://twitchmemes.ru'
              : (process.env.API_URL || 'http://localhost:3001');
            const webhookUrl = `${apiUrl}/webhooks/twitch/eventsub`;
            
            // Check existing subscriptions first
            try {
              const existingSubs = await getEventSubSubscriptions(channel.twitchChannelId);
              
              // Check if we already have an active subscription for this event type
              const hasActiveSubscription = existingSubs?.data?.some((sub: any) => 
                sub.type === 'channel.channel_points_custom_reward_redemption.add' && 
                (sub.status === 'enabled' || sub.status === 'webhook_callback_verification_pending')
              );
              
              if (hasActiveSubscription) {
                // Subscription already exists and is active, skip creation
              } else {
                // Create new subscription
                const subscriptionResult = await createEventSubSubscription(
                  userId,
                  channel.twitchChannelId,
                  webhookUrl,
                  process.env.TWITCH_EVENTSUB_SECRET!
                );
              }
            } catch (checkError: any) {
              // If check fails, try to create anyway
              console.error('Error checking subscriptions, will try to create:', checkError);
              const subscriptionResult = await createEventSubSubscription(
                userId,
                channel.twitchChannelId,
                webhookUrl,
                process.env.TWITCH_EVENTSUB_SECRET!
              );
            }
          } catch (error: any) {
            // Log but don't fail - subscription might already exist
            console.error('Error creating EventSub subscription:', error);
          }
        } else {
          // Disable reward - disable in Twitch but don't delete
          if (channel.rewardIdForCoins) {
            try {
              await updateChannelReward(
                userId,
                channel.twitchChannelId,
                channel.rewardIdForCoins,
                {
                  is_enabled: false,
                }
              );
            } catch (error: any) {
              console.error('Error disabling reward:', error);
              // If reward doesn't exist, just continue
            }
          }
        }
      }

      // Update channel in database
      const updateData: any = {
        rewardIdForCoins: body.rewardIdForCoins !== undefined ? body.rewardIdForCoins : (channel as any).rewardIdForCoins,
        coinPerPointRatio: body.coinPerPointRatio !== undefined ? body.coinPerPointRatio : channel.coinPerPointRatio,
        rewardEnabled: body.rewardEnabled !== undefined ? body.rewardEnabled : (channel as any).rewardEnabled,
        rewardTitle: body.rewardTitle !== undefined ? body.rewardTitle : (channel as any).rewardTitle,
        rewardCost: body.rewardCost !== undefined ? body.rewardCost : (channel as any).rewardCost,
        rewardCoins: body.rewardCoins !== undefined ? body.rewardCoins : (channel as any).rewardCoins,
        primaryColor: body.primaryColor !== undefined ? body.primaryColor : (channel as any).primaryColor,
        secondaryColor: body.secondaryColor !== undefined ? body.secondaryColor : (channel as any).secondaryColor,
        accentColor: body.accentColor !== undefined ? body.accentColor : (channel as any).accentColor,
      };
      
      // Only update coinIconUrl if we have a value or if reward is being disabled
      if (coinIconUrl !== null || body.rewardEnabled === false) {
        updateData.coinIconUrl = body.rewardEnabled === false ? null : coinIconUrl;
      }
      
      const updatedChannel = await prisma.channel.update({
        where: { id: channelId },
        data: updateData,
      });

      res.json(updatedChannel);
    } catch (error: any) {
      console.error('Error updating channel settings:', error);
      if (error instanceof ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      return res.status(500).json({ error: error.message || 'Failed to update channel settings' });
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


