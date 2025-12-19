import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { Server } from 'socket.io';
import { approveSubmissionSchema, rejectSubmissionSchema, updateMemeSchema, updateChannelSettingsSchema } from '../shared/index.js';
import { getOrCreateTags } from '../utils/tags.js';
import { calculateFileHash, findOrCreateFileHash, getFileStats, getFileHashByPath, incrementFileHashReference, downloadAndDeduplicateFile } from '../utils/fileHash.js';
import { validatePathWithinDirectory } from '../utils/pathSecurity.js';
import { logAdminAction } from '../utils/auditLogger.js';
import { getVideoMetadata } from '../utils/videoValidator.js';
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
  deleteEventSubSubscription,
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

    // #region agent log
    console.log('[DEBUG] approveSubmission started', JSON.stringify({ location: 'adminController.ts:119', message: 'approveSubmission started', data: { submissionId: id, channelId }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }));
    // #endregion

    let submission: any; // Declare submission in outer scope for error handling
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

        // Get channel to use default price and slug for Socket.IO
        // #region agent log
        console.log('[DEBUG] Fetching channel for default price', JSON.stringify({ location: 'adminController.ts:162', message: 'Fetching channel for default price', data: { channelId }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'G' }));
        // #endregion
        
        const channel = await tx.channel.findUnique({
          where: { id: channelId },
          select: { defaultPriceCoins: true, slug: true },
        });
        
        // #region agent log
        console.log('[DEBUG] Channel fetched', JSON.stringify({ location: 'adminController.ts:166', message: 'Channel fetched', data: { channelId, found: !!channel, defaultPriceCoins: channel?.defaultPriceCoins }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'G' }));
        // #endregion
        
        const defaultPrice = channel?.defaultPriceCoins ?? 100; // Use channel default or 100 as fallback

        // Determine fileUrl: handle deduplication for both uploaded and imported files
        let finalFileUrl: string;
        let fileHash: string | null = null;
        let filePath: string | null = null; // Declare filePath in wider scope
        
        // #region agent log
        console.log('[DEBUG] Processing file URL', JSON.stringify({ location: 'adminController.ts:165', message: 'Processing file URL', data: { submissionId: id, hasSourceUrl: !!submission.sourceUrl, fileUrlTemp: submission.fileUrlTemp }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' }));
        // #endregion
        
        if (submission.sourceUrl) {
          // Imported meme - use sourceUrl temporarily, download will happen in background
          // This prevents timeout issues - we approve immediately and download async
          finalFileUrl = submission.sourceUrl;
        } else {
          // Uploaded file - check if already deduplicated or perform deduplication
          // Validate path to prevent path traversal attacks
          try {
            const uploadsDir = path.join(process.cwd(), 'uploads');
            // If fileUrlTemp starts with /, remove it before validation
            const relativePath = submission.fileUrlTemp.startsWith('/') 
              ? submission.fileUrlTemp.slice(1) 
              : submission.fileUrlTemp;
            
            // #region agent log
            console.log('[DEBUG] Validating file path', JSON.stringify({ location: 'adminController.ts:178', message: 'Validating file path', data: { submissionId: id, fileUrlTemp: submission.fileUrlTemp, relativePath, uploadsDir }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }));
            // #endregion
            
            filePath = validatePathWithinDirectory(relativePath, uploadsDir);
            
            // #region agent log
            console.log('[DEBUG] Path validated', JSON.stringify({ location: 'adminController.ts:184', message: 'Path validated', data: { submissionId: id, filePath, fileExists: fs.existsSync(filePath) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }));
            // #endregion
          } catch (pathError: any) {
            // #region agent log
            console.log('[DEBUG] Path validation failed', JSON.stringify({ location: 'adminController.ts:186', message: 'Path validation failed', data: { submissionId: id, fileUrlTemp: submission.fileUrlTemp, error: pathError.message }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }));
            // #endregion
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

        // Get video duration from metadata if available
        const STANDARD_DURATION_MS = 15000; // 15 seconds (15000ms) fallback
        let durationMs = body.durationMs || STANDARD_DURATION_MS;
        
        // Try to get real video duration from file metadata
        if (!submission.sourceUrl && filePath && fs.existsSync(filePath)) {
          try {
            const metadata = await getVideoMetadata(filePath);
            if (metadata && metadata.duration > 0) {
              durationMs = Math.round(metadata.duration * 1000); // Convert seconds to milliseconds
            }
          } catch (error: any) {
            console.warn('Failed to get video duration, using default:', error.message);
            // Use body.durationMs or fallback to standard
            durationMs = body.durationMs || STANDARD_DURATION_MS;
          }
        }
        
        // Use channel default price or body price
        const priceCoins = body.priceCoins || defaultPrice;

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
          // #region agent log
          console.log('[DEBUG] Creating meme in transaction', JSON.stringify({ location: 'adminController.ts:333', message: 'Creating meme in transaction', data: { submissionId: id, channelId: submission.channelId, hasTags: tagIds.length > 0, fileUrl: finalFileUrl }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'I' }));
          // #endregion
          
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
          console.log('[DEBUG] Meme created successfully', JSON.stringify({ location: 'adminController.ts:357', message: 'Meme created successfully', data: { submissionId: id, memeId: meme.id }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'I' }));
          // #endregion

          return meme;
        } catch (error: any) {
          // #region agent log
          console.log('[DEBUG] Error creating meme', JSON.stringify({ location: 'adminController.ts:360', message: 'Error creating meme', data: { submissionId: id, errorMessage: error.message, errorName: error.name, errorCode: error instanceof PrismaClientKnownRequestError ? error.code : undefined, stack: error.stack }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'I' }));
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
      }).catch((txError: any) => {
        // #region agent log
        console.log('[DEBUG] Transaction failed', JSON.stringify({ location: 'adminController.ts:375', message: 'Transaction failed', data: { submissionId: id, errorMessage: txError.message, errorName: txError.name, errorCode: txError.code, stack: txError.stack }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'J' }));
        // #endregion
        throw txError;
      });
      
      // #region agent log
      console.log('[DEBUG] Transaction completed successfully', JSON.stringify({ location: 'adminController.ts:380', message: 'Transaction completed successfully', data: { submissionId: id, resultId: result?.id }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'J' }));
      // #endregion

      // Emit Socket.IO event for submission approval
      try {
        const io: Server = req.app.get('io');
        const channel = await prisma.channel.findUnique({
          where: { id: channelId },
          select: { slug: true },
        });
        if (channel) {
          io.to(`channel:${String(channel.slug).toLowerCase()}`).emit('submission:approved', {
            submissionId: id,
            channelId,
            moderatorId: req.userId,
          });
          // Also emit to user room for the moderator
          if (req.userId) {
            io.to(`user:${req.userId}`).emit('submission:approved', {
              submissionId: id,
              channelId,
              moderatorId: req.userId,
            });
          }
        }
      } catch (error) {
        console.error('Error emitting submission:approved event:', error);
        // Don't fail the request if Socket.IO emit fails
      }

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
      // #region agent log
      console.log('[DEBUG] Error in approveSubmission', JSON.stringify({ location: 'adminController.ts:377', message: 'Error in approveSubmission', data: { submissionId: id, errorMessage: error.message, errorName: error.name, errorCode: error.code, stack: error.stack }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
      // #endregion
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
        const errorCode = error instanceof PrismaClientKnownRequestError ? error.code : undefined;
        const errorMeta = error instanceof PrismaClientKnownRequestError ? error.meta : undefined;
        
        // #region agent log
        console.log('[DEBUG] Prisma error in approveSubmission', JSON.stringify({ location: 'adminController.ts:426', message: 'Prisma error in approveSubmission', data: { submissionId: id, errorCode, errorMessage: error.message, meta: errorMeta }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'H' }));
        // #endregion
        console.error('Prisma error in approveSubmission:', error.message, errorCode, errorMeta);
        
        // Handle transaction aborted error (25P02)
        if (error.message?.includes('current transaction is aborted') || error.message?.includes('25P02') || errorCode === 'P2025') {
          return res.status(500).json({
            error: 'Database transaction error',
            message: 'Transaction was aborted. Please try again.',
          });
        }

        // Handle record not found (P2025)
        if (errorCode === 'P2025') {
          return res.status(404).json({
            error: 'Record not found',
            message: 'The requested record was not found in the database.',
          });
        }

        // Handle other Prisma errors with more detail
        return res.status(500).json({
          error: 'Database error',
          message: process.env.NODE_ENV === 'development' 
            ? `Database error: ${error.message}${errorCode ? ` (code: ${errorCode})` : ''}`
            : 'An error occurred while processing the request. Please try again.',
        });
      }

      // Handle specific error messages
      if (error.message === 'Submission not found' || error.message === 'Submission already processed') {
        return res.status(400).json({ error: error.message });
      }

      if (error.message === 'Uploaded file not found') {
        return res.status(404).json({ error: error.message });
      }

      // Handle file operation errors with more specific messages
      if (error.message?.includes('Hash calculation timeout') || 
          error.message?.includes('file') || 
          error.message?.includes('File') ||
          error.message?.includes('Invalid file path') ||
          error.message?.includes('Uploaded file not found')) {
        console.error('File operation error in approveSubmission:', error.message, {
          submissionId: id,
          fileUrlTemp: submission?.fileUrlTemp,
          stack: error.stack,
        });
        return res.status(500).json({
          error: 'File operation error',
          message: error.message?.includes('not found') 
            ? 'The uploaded file was not found. Please try uploading again.'
            : 'An error occurred while processing the file. Please try again.',
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

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:449',message:'rejectSubmission started',data:{submissionId:id,channelId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion

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

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:496',message:'rejectSubmission success',data:{submissionId:id,status:updated.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion

      // Emit Socket.IO event for submission rejection
      try {
        const io: Server = req.app.get('io');
        const channel = await prisma.channel.findUnique({
          where: { id: channelId },
          select: { slug: true },
        });
        if (channel) {
          io.to(`channel:${String(channel.slug).toLowerCase()}`).emit('submission:rejected', {
            submissionId: id,
            channelId,
            moderatorId: req.userId,
          });
          // Also emit to user room for the moderator
          if (req.userId) {
            io.to(`user:${req.userId}`).emit('submission:rejected', {
              submissionId: id,
              channelId,
              moderatorId: req.userId,
            });
          }
        }
      } catch (error) {
        console.error('Error emitting submission:rejected event:', error);
        // Don't fail the request if Socket.IO emit fails
      }
      
      res.json(updated);
    } catch (error: any) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:500',message:'Error in rejectSubmission',data:{submissionId:id,errorMessage:error.message,errorName:error.name,errorCode:error.code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      console.error('Error in rejectSubmission:', error);
      if (!res.headersSent) {
        // Handle validation errors (ZodError)
        if (error instanceof ZodError) {
          return res.status(400).json({
            error: 'Validation error',
            message: 'Validation failed',
            details: error.errors,
          });
        }

        // Handle specific error messages
        if (error.message === 'Submission not found' || error.message === 'Submission already processed') {
          return res.status(400).json({ error: error.message });
        }

        return res.status(500).json({
          error: 'Internal server error',
          message: 'Failed to reject submission',
        });
      }
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
        status: {
          not: 'deleted', // Exclude deleted memes
        },
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

  deleteMeme: async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const channelId = req.channelId;

    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID required' });
    }

    try {
      const meme = await prisma.meme.findUnique({
        where: { id },
      });

      if (!meme || meme.channelId !== channelId) {
        return res.status(404).json({ error: 'Meme not found' });
      }

      // Soft delete: change status to 'deleted'
      const deleted = await prisma.meme.update({
        where: { id },
        data: { status: 'deleted' },
        include: {
          createdBy: {
            select: {
              id: true,
              displayName: true,
            },
          },
        },
      });

      // Log admin action
      await logAdminAction(
        'delete_meme',
        req.userId!,
        channelId,
        id,
        {
          memeTitle: meme.title,
        },
        true,
        req
      );

      res.json(deleted);
    } catch (error: any) {
      console.error('Error in deleteMeme:', error);
      if (!res.headersSent) {
        return res.status(500).json({
          error: 'Internal server error',
          message: 'Failed to delete meme',
        });
      }
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
            // Use the current request host as the webhook callback base URL.
            // This avoids hardcoding production domain and prevents beta from registering prod callbacks.
            const domain = process.env.DOMAIN || 'twitchmemes.ru';
            const reqHost = req.get('host') || '';
            const allowedHosts = new Set([domain, `www.${domain}`, `beta.${domain}`]);
            const apiBaseUrl = allowedHosts.has(reqHost) ? `https://${reqHost}` : `https://${domain}`;
            const webhookUrl = `${apiBaseUrl}/webhooks/twitch/eventsub`;
            
            // Check existing subscriptions first
            try {
              const existingSubs = await getEventSubSubscriptions(channel.twitchChannelId);
              
              // Check if we already have an active subscription for this event type
              const relevantSubs = (existingSubs?.data || []).filter((sub: any) =>
                sub.type === 'channel.channel_points_custom_reward_redemption.add' &&
                (sub.status === 'enabled' || sub.status === 'webhook_callback_verification_pending')
              );

              const hasActiveSubscription = relevantSubs.some((sub: any) => sub.transport?.callback === webhookUrl);
              
              if (hasActiveSubscription) {
                // Subscription already exists and is active, skip creation
              } else {
                // If there is an active subscription but with a different callback, log it.
                const mismatchedSubs = relevantSubs.filter((s: any) => s.transport?.callback !== webhookUrl);
                if (mismatchedSubs.length > 0) {
                  console.warn('[adminController] EventSub subscription callback mismatch, will delete and re-create', {
                    desiredWebhookUrl: webhookUrl,
                    existingCallbacks: mismatchedSubs.map((s: any) => ({ id: s.id, status: s.status, callback: s.transport?.callback })),
                  });
                  // Delete mismatched subscriptions to allow a deterministic re-register
                  for (const sub of mismatchedSubs) {
                    try {
                      await deleteEventSubSubscription(sub.id);
                      console.log('[adminController] Deleted EventSub subscription:', { id: sub.id, callback: sub.transport?.callback });
                    } catch (deleteErr) {
                      console.error('[adminController] Failed to delete EventSub subscription:', { id: sub.id, error: (deleteErr as any)?.message });
                    }
                  }
                }
                // Create new subscription
                try {
                  await createEventSubSubscription(
                    userId,
                    channel.twitchChannelId,
                    webhookUrl,
                    process.env.TWITCH_EVENTSUB_SECRET!
                  );
                } catch (createErr: any) {
                  // If Twitch says "already exists", do a best-effort cleanup and retry once.
                  if (createErr?.status === 409) {
                    console.warn('[adminController] EventSub create returned 409, retrying after cleanup', {
                      desiredWebhookUrl: webhookUrl,
                      error: createErr?.message,
                    });
                    for (const sub of relevantSubs) {
                      try {
                        await deleteEventSubSubscription(sub.id);
                      } catch (deleteErr) {
                        console.error('[adminController] Cleanup delete failed:', { id: sub.id, error: (deleteErr as any)?.message });
                      }
                    }
                    await createEventSubSubscription(
                      userId,
                      channel.twitchChannelId,
                      webhookUrl,
                      process.env.TWITCH_EVENTSUB_SECRET!
                    );
                  } else {
                    throw createErr;
                  }
                }
              }
            } catch (checkError: any) {
              // If check fails, try to create anyway
              console.error('Error checking subscriptions, will try to create:', checkError);
              await createEventSubSubscription(
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

    try {
      // Add timeout protection for promotions query
      const promotionsPromise = prisma.promotion.findMany({
        where: { channelId },
        orderBy: { createdAt: 'desc' },
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Promotions query timeout')), 5000); // 5 second timeout
      });

      const promotions = await Promise.race([promotionsPromise, timeoutPromise]);
      res.json(promotions);
    } catch (error: any) {
      console.error('Error in getPromotions:', error);
      if (!res.headersSent) {
        // If timeout or table doesn't exist, return empty array
        if (error.message?.includes('timeout') || error.message?.includes('does not exist') || error.code === 'P2021') {
          return res.json([]);
        }
        return res.status(500).json({
          error: 'Failed to load promotions',
          message: 'An error occurred while loading promotions',
        });
      }
    }
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


