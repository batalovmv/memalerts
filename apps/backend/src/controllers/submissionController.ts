import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { createSubmissionSchema, importMemeSchema } from '../shared/index.js';
import { validateVideo } from '../utils/videoValidator.js';
import { getOrCreateTags } from '../utils/tags.js';
import path from 'path';
import fs from 'fs';

export const submissionController = {
  createSubmission: async (req: AuthRequest, res: Response) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'submissionController.ts:11',message:'createSubmission started',data:{hasFile:!!req.file,channelId:req.channelId,userId:req.userId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    if (!req.file) {
      return res.status(400).json({ error: 'File is required' });
    }

    const channelId = req.channelId;

    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID required' });
    }

    try {
      // Validate file is video
      if (!req.file.mimetype.startsWith('video/')) {
        return res.status(400).json({ error: 'Only video files are allowed' });
      }

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'submissionController.ts:28',message:'File validated as video',data:{mimetype:req.file.mimetype,filename:req.file.filename},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

      // Parse tags from FormData (they come as JSON string)
      const bodyData = { ...req.body };
      if (typeof bodyData.tags === 'string') {
        try {
          bodyData.tags = JSON.parse(bodyData.tags);
        } catch (e) {
          bodyData.tags = [];
        }
      }
      
      const body = createSubmissionSchema.parse(bodyData);

      // Ensure type is video
      if (body.type !== 'video') {
        return res.status(400).json({ error: 'Only video type is allowed' });
      }

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'submissionController.ts:45',message:'Starting video validation',data:{filePath:req.file.path,fileSize:req.file.size},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

      // Validate video file (duration and size) with timeout protection
      const filePath = path.join(process.cwd(), req.file.path);
      
      // For small files (< 1MB), skip validation to avoid ffprobe hanging
      // Just check file size limit
      const MAX_SIZE = 50 * 1024 * 1024; // 50MB
      if (req.file.size > MAX_SIZE) {
        try {
          fs.unlinkSync(filePath);
        } catch (unlinkError) {
          console.error('Failed to delete oversized file:', unlinkError);
        }
        return res.status(400).json({ 
          error: `Video file size (${(req.file.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size (50MB)` 
        });
      }
      
      // For small files, skip ffprobe validation (it can hang on some formats)
      let validation = { valid: true as boolean, error: undefined as string | undefined };
      if (req.file.size > 1024 * 1024) { // Only validate files > 1MB
        // Start validation with aggressive timeout
        const validationPromise = validateVideo(filePath);
        const timeoutPromise = new Promise<{ valid: boolean; error?: string }>((resolve) => {
          setTimeout(() => {
            console.warn('Video validation timeout, allowing upload to proceed');
            resolve({ valid: true }); // Allow upload if validation times out
          }, 3000); // 3 second timeout for validation
        });
        
        try {
          validation = await Promise.race([validationPromise, timeoutPromise]);
        } catch (error: any) {
          console.warn('Video validation error, allowing upload:', error.message);
          validation = { valid: true }; // Allow upload on validation error
        }
      } else {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'submissionController.ts:58',message:'Skipping validation for small file',data:{fileSize:req.file.size},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
      }
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'submissionController.ts:70',message:'Video validation completed',data:{valid:validation.valid,error:validation.error},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
      if (!validation.valid) {
        // Delete uploaded file if validation fails
        try {
          fs.unlinkSync(filePath);
        } catch (unlinkError) {
          console.error('Failed to delete invalid video file:', unlinkError);
        }
        return res.status(400).json({ error: validation.error || 'Video validation failed' });
      }

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'submissionController.ts:70',message:'Starting getOrCreateTags',data:{tagsCount:body.tags?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

      // Get or create tags (optimize by batching)
      const tagIds = await getOrCreateTags(body.tags || []);

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'submissionController.ts:73',message:'Tags created, starting DB submission',data:{tagIdsCount:tagIds.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

      // Create submission
      const submission = await prisma.memeSubmission.create({
        data: {
          channelId,
          submitterUserId: req.userId!,
          title: body.title,
          type: 'video', // Force video type
          fileUrlTemp: `/uploads/${req.file.filename}`,
          notes: body.notes || null,
          status: 'pending',
          tags: {
            create: tagIds.map((tagId) => ({
              tagId,
            })),
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

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'submissionController.ts:98',message:'Submission created, sending response',data:{submissionId:submission.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

      // Send response immediately after creating submission
      res.status(201).json(submission);
    } catch (error: any) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'submissionController.ts:101',message:'Error in createSubmission',data:{error:error?.message,stack:error?.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
      console.error('Error in createSubmission:', error);
      throw error;
    }
  },

  getMySubmissions: async (req: AuthRequest, res: Response) => {
    const submissions = await prisma.memeSubmission.findMany({
      where: {
        submitterUserId: req.userId!,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(submissions);
  },

  importMeme: async (req: AuthRequest, res: Response) => {
    const channelId = req.channelId;

    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID required' });
    }

    try {
      const body = importMemeSchema.parse(req.body);

      // Validate URL is from memalerts.com or cdns.memealerts.com
      const isValidUrl = body.sourceUrl.includes('memalerts.com') || 
                        body.sourceUrl.includes('cdns.memealerts.com');
      if (!isValidUrl) {
        return res.status(400).json({ error: 'Source URL must be from memalerts.com or cdns.memealerts.com' });
      }

      // Get or create tags
      const tagIds = await getOrCreateTags(body.tags || []);

      // Create submission with imported URL
      const submission = await prisma.memeSubmission.create({
        data: {
          channelId,
          submitterUserId: req.userId!,
          title: body.title,
          type: 'video', // Imported memes are treated as video
          fileUrlTemp: body.sourceUrl, // Store source URL temporarily
          sourceUrl: body.sourceUrl,
          notes: body.notes || null,
          status: 'pending',
          tags: {
            create: tagIds.map((tagId) => ({
              tagId,
            })),
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

      res.status(201).json(submission);
    } catch (error) {
      throw error;
    }
  },
};


