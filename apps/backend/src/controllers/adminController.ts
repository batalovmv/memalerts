import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { approveSubmissionSchema, rejectSubmissionSchema, updateMemeSchema, updateChannelSettingsSchema } from '../shared/index.js';
import { getOrCreateTags } from '../utils/tags.js';
import { calculateFileHash, findOrCreateFileHash, getFileStats, getFileHashByPath, incrementFileHashReference, downloadAndDeduplicateFile } from '../utils/fileHash.js';
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:100',message:'approveSubmission entry',data:{submissionId:req.params.id,channelId:req.channelId,body:req.body},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    const { id } = req.params;
    const channelId = req.channelId;

    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID required' });
    }

    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:109',message:'before schema parse',data:{body:req.body},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      const body = approveSubmissionSchema.parse(req.body);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:111',message:'after schema parse success',data:{parsedBody:body},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

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

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:122',message:'before transaction start',data:{submissionId:id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      const result = await prisma.$transaction(async (tx) => {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:123',message:'inside transaction',data:{submissionId:id},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        // Get submission WITHOUT tags to avoid transaction abort if MemeSubmissionTag table doesn't exist
        // The table may not exist on production, so we fetch without tags from the start
        let submission: any;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:127',message:'before findUnique submission (no tags)',data:{submissionId:id},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        try {
          submission = await tx.memeSubmission.findUnique({
            where: { id },
          });
          // Add empty tags array to match expected structure
          if (submission) {
            submission.tags = [];
          }
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:136',message:'after findUnique submission success',data:{submissionFound:!!submission,submissionId:submission?.id,status:submission?.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'C'})}).catch(()=>{});
          // #endregion
        } catch (error: any) {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:137',message:'error in findUnique submission',data:{errorMessage:error?.message,errorCode:error?.code,errorName:error?.name,errorStack:error?.stack?.substring(0,500)},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'C'})}).catch(()=>{});
          // #endregion
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
          const filePath = path.join(process.cwd(), submission.fileUrlTemp);
          
          // Check if file already exists in FileHash (was deduplicated during upload)
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:179',message:'before getFileHashByPath',data:{fileUrlTemp:submission.fileUrlTemp},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
          // #endregion
          const existingHash = await getFileHashByPath(submission.fileUrlTemp);
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:181',message:'after getFileHashByPath',data:{existingHash:existingHash},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
          // #endregion
          
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
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:222',message:'before getOrCreateTags',data:{tagNames:tagNames},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
            // #endregion
            const tagsPromise = getOrCreateTags(tagNames);
            const tagsTimeout = new Promise<string[]>((resolve) => {
              setTimeout(() => {
                console.warn('Tags creation timeout, proceeding without tags');
                resolve([]);
              }, 3000); // 3 second timeout for tags
            });
            tagIds = await Promise.race([tagsPromise, tagsTimeout]);
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:230',message:'after getOrCreateTags success',data:{tagIds:tagIds},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
            // #endregion
          } catch (error: any) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:231',message:'error in getOrCreateTags',data:{errorMessage:error?.message,errorName:error?.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
            // #endregion
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
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:282',message:'before meme.create',data:{memeDataKeys:Object.keys(memeData),hasFileHash:!!memeData.fileHash,hasTags:!!memeData.tags},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion

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
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:294',message:'after meme.create success',data:{memeId:meme.id,createdBy:!!meme.createdBy,createdByDisplayName:meme.createdBy?.displayName},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion

          return meme;
        } catch (error: any) {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:296',message:'error in meme.create',data:{errorMessage:error?.message,errorCode:error?.code,errorName:error?.name,isPrismaKnown:error instanceof PrismaClientKnownRequestError,isPrismaUnknown:error instanceof PrismaClientUnknownRequestError,errorStack:error?.stack?.substring(0,500)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
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
      if (submissionForBackground?.sourceUrl && result) {
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
          console.error(`Background download failed for meme ${result.id}:`, error.message);
          // File will continue using sourceUrl - that's okay, it will work
        });
      }

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:339',message:'before res.json success',data:{resultId:result?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      res.json(result);
    } catch (error: any) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:340',message:'catch block entry',data:{errorMessage:error?.message,errorName:error?.name,errorCode:error?.code,isZodError:error instanceof ZodError,isPrismaKnown:error instanceof PrismaClientKnownRequestError,isPrismaUnknown:error instanceof PrismaClientUnknownRequestError,errorStack:error?.stack?.substring(0,1000)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      console.error('Error in approveSubmission:', error);

      // Don't send response if headers already sent
      if (res.headersSent) {
        console.error('Error occurred after response was sent in approveSubmission');
        return;
      }

      // Handle validation errors (ZodError)
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:350',message:'checking ZodError',data:{isZodError:error instanceof ZodError,zodErrors:error instanceof ZodError ? error.errors : null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Validation error',
          message: 'Validation failed',
          details: error.errors,
        });
      }

      // Handle Prisma errors
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:359',message:'checking Prisma errors',data:{isPrismaKnown:error instanceof PrismaClientKnownRequestError,isPrismaUnknown:error instanceof PrismaClientUnknownRequestError,errorMessage:error?.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:396',message:'fallback to generic error',data:{errorMessage:error?.message,errorName:error?.name,nodeEnv:process.env.NODE_ENV},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
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

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:598',message:'updateChannelSettings called',data:{channelId,userId,hasRewardEnabled:req.body?.rewardEnabled},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion

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

          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:615',message:'Checking user token before reward operation',data:{userId,hasAccessToken:!!userWithToken?.twitchAccessToken,hasRefreshToken:!!userWithToken?.twitchRefreshToken},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
          // #endregion

          if (!userWithToken || !userWithToken.twitchAccessToken) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:620',message:'No token found, returning error',data:{userId,userExists:!!userWithToken},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
            // #endregion
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
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:647',message:'Fetched existing rewards',data:{userId,channelId:channel.twitchChannelId,rewardsCount:rewards?.data?.length || 0,storedRewardId:channel.rewardIdForCoins,allRewardIds:rewards?.data?.map((r:any)=>r.id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
            // #endregion
            
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
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:680',message:'Deleting old reward',data:{userId,channelId:channel.twitchChannelId,oldRewardId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
              // #endregion
              await deleteChannelReward(userId, channel.twitchChannelId, oldRewardId);
            } catch (error: any) {
              console.error('Error deleting old reward:', error);
              // Continue even if deletion fails
            }
          }

          let coinIconUrl: string | null = null;
          
          if (existingRewardId) {
            // Update existing reward
            try {
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:670',message:'Updating existing reward',data:{userId,channelId:channel.twitchChannelId,rewardId:existingRewardId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
              // #endregion
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
              
              // Fetch reward details to get image URL
              try {
                const rewardDetails = await getChannelRewards(userId, channel.twitchChannelId, existingRewardId);
                if (rewardDetails?.data?.[0]?.image?.url_1x || rewardDetails?.data?.[0]?.image?.url_2x || rewardDetails?.data?.[0]?.image?.url_4x) {
                  coinIconUrl = rewardDetails.data[0].image.url_1x || rewardDetails.data[0].image.url_2x || rewardDetails.data[0].image.url_4x;
                }
              } catch (error) {
                console.error('Error fetching reward details for icon:', error);
              }
            } catch (error: any) {
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:685',message:'Error updating reward, will create new',data:{error:error.message,rewardId:existingRewardId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
              // #endregion
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
              
              // Extract image URL from reward response
              if (rewardResponse?.data?.[0]?.image?.url_1x || rewardResponse?.data?.[0]?.image?.url_2x || rewardResponse?.data?.[0]?.image?.url_4x) {
                coinIconUrl = rewardResponse.data[0].image.url_1x || rewardResponse.data[0].image.url_2x || rewardResponse.data[0].image.url_4x;
              }
            }
          } else {
            // Create new reward
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:700',message:'Creating new reward',data:{userId,channelId:channel.twitchChannelId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
            // #endregion
            const rewardResponse = await createChannelReward(
              userId,
              channel.twitchChannelId,
              body.rewardTitle || `Get ${body.rewardCoins} Coins`,
              body.rewardCost,
              `Redeem ${body.rewardCost} channel points to get ${body.rewardCoins} coins!`
            );
            body.rewardIdForCoins = rewardResponse.data[0].id;
            
            // Extract image URL from reward response
            if (rewardResponse?.data?.[0]?.image?.url_1x || rewardResponse?.data?.[0]?.image?.url_2x || rewardResponse?.data?.[0]?.image?.url_4x) {
              coinIconUrl = rewardResponse.data[0].image.url_1x || rewardResponse.data[0].image.url_2x || rewardResponse.data[0].image.url_4x;
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
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:750',message:'Checked existing subscriptions',data:{userId,channelId:channel.twitchChannelId,subscriptionsCount:existingSubs?.data?.length || 0,subscriptions:existingSubs?.data?.map((s:any)=>({id:s.id,type:s.type,status:s.status}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'M'})}).catch(()=>{});
              // #endregion
              
              // Check if we already have an active subscription for this event type
              const hasActiveSubscription = existingSubs?.data?.some((sub: any) => 
                sub.type === 'channel.channel_points_custom_reward_redemption.add' && 
                (sub.status === 'enabled' || sub.status === 'webhook_callback_verification_pending')
              );
              
              if (hasActiveSubscription) {
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:758',message:'Active subscription already exists, skipping creation',data:{channelId:channel.twitchChannelId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'M'})}).catch(()=>{});
                // #endregion
                // Subscription already exists and is active, skip creation
              } else {
                // Create new subscription
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:763',message:'Creating EventSub subscription',data:{userId,channelId:channel.twitchChannelId,webhookUrl,apiUrl,nodeEnv:process.env.NODE_ENV},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'L'})}).catch(()=>{});
                // #endregion
                const subscriptionResult = await createEventSubSubscription(
                  userId,
                  channel.twitchChannelId,
                  webhookUrl,
                  process.env.TWITCH_EVENTSUB_SECRET!
                );
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:771',message:'EventSub subscription created successfully',data:{subscriptionId:subscriptionResult?.data?.[0]?.id,status:subscriptionResult?.data?.[0]?.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'L'})}).catch(()=>{});
                // #endregion
              }
            } catch (checkError: any) {
              // If check fails, try to create anyway
              console.error('Error checking subscriptions, will try to create:', checkError);
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:777',message:'Error checking subscriptions, creating new',data:{error:checkError.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'M'})}).catch(()=>{});
              // #endregion
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
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:789',message:'EventSub subscription error',data:{error:error.message,errorStack:error.stack?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'L'})}).catch(()=>{});
            // #endregion
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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:681',message:'Updating channel in DB',data:{channelId,rewardEnabled:body.rewardEnabled,rewardIdForCoins:body.rewardIdForCoins,rewardCost:body.rewardCost,rewardCoins:body.rewardCoins,coinIconUrl},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
      // #endregion
      
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

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:697',message:'Channel updated in DB',data:{channelId:updatedChannel.id,rewardEnabled:updatedChannel.rewardEnabled,rewardIdForCoins:updatedChannel.rewardIdForCoins,rewardCost:updatedChannel.rewardCost,rewardCoins:updatedChannel.rewardCoins},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
      // #endregion

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


