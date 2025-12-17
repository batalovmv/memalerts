import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { createSubmissionSchema, importMemeSchema } from '../shared/index.js';
import { validateVideo } from '../utils/videoValidator.js';
import { getOrCreateTags } from '../utils/tags.js';
import { calculateFileHash, findOrCreateFileHash, getFileStats } from '../utils/fileHash.js';
import { validateFileContent } from '../utils/fileTypeValidator.js';
import { logFileUpload, logSecurityEvent } from '../utils/auditLogger.js';
import path from 'path';
import fs from 'fs';

export const submissionController = {
  createSubmission: async (req: AuthRequest, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: 'File is required' });
    }

    // Determine channelId: use from body/query if provided, otherwise use from token
    let channelId = req.body.channelId || req.query.channelId;
    if (!channelId) {
      channelId = req.channelId;
    }

    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID required' });
    }

    // Validate that the channel exists
    const channel = await prisma.channel.findUnique({
      where: { id: channelId as string },
    });

    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    try {
      // Validate file is video
      if (!req.file.mimetype.startsWith('video/')) {
        return res.status(400).json({ error: 'Only video files are allowed' });
      }

      // Validate file content using magic bytes (prevents MIME type spoofing)
      const filePath = path.join(process.cwd(), req.file.path);
      const contentValidation = await validateFileContent(filePath, req.file.mimetype);
      if (!contentValidation.valid) {
        // Delete the uploaded file if validation fails
        try {
          fs.unlinkSync(filePath);
        } catch (unlinkError) {
          console.error('Failed to delete invalid file:', unlinkError);
        }
        
        // Log security event
        await logSecurityEvent(
          'file_validation_failed',
          req.userId!,
          channelId as string,
          {
            fileName: req.file.originalname,
            declaredType: req.file.mimetype,
            detectedType: contentValidation.detectedType,
            error: contentValidation.error,
          },
          req
        );
        
        return res.status(400).json({ 
          error: 'Invalid file content',
          message: contentValidation.error || 'File content does not match declared file type'
        });
      }

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

      // Skip video validation completely to avoid ffprobe hanging
      // Just check file size limit
      // Note: filePath is already set above during content validation
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

      // Calculate file hash and perform deduplication
      let finalFilePath: string;
      let fileHash: string | null = null;
      try {
        const hash = await calculateFileHash(filePath);
        const stats = await getFileStats(filePath);
        const result = await findOrCreateFileHash(filePath, hash, stats.mimeType, stats.size);
        finalFilePath = result.filePath;
        fileHash = hash;
        console.log(`File deduplication: ${result.isNew ? 'new file' : 'duplicate found'}, hash: ${hash}`);
      } catch (error: any) {
        console.error('File hash calculation failed, using original path:', error);
        // Fallback to original path if hash calculation fails
        finalFilePath = `/uploads/${req.file.filename}`;
      }

      // Get or create tags with timeout protection
      let tagIds: string[] = [];
      try {
        const tagsPromise = getOrCreateTags(body.tags || []);
        const tagsTimeout = new Promise<string[]>((resolve) => {
          setTimeout(() => {
            console.warn('Tags creation timeout, proceeding without tags');
            resolve([]); // Proceed without tags if timeout
          }, 5000); // 5 second timeout for tags
        });
        tagIds = await Promise.race([tagsPromise, tagsTimeout]);
      } catch (error: any) {
        console.warn('Error creating tags, proceeding without tags:', error.message);
        tagIds = []; // Proceed without tags on error
      }

      // Create submission with timeout protection
      // If tagIds is empty or tags table doesn't exist, create without tags
      const submissionData: any = {
        channelId,
        submitterUserId: req.userId!,
        title: body.title,
        type: 'video', // Force video type
        fileUrlTemp: finalFilePath, // Use deduplicated file path
        notes: body.notes || null,
        status: 'pending',
      };

      // Only add tags if we have tagIds (and table exists)
      if (tagIds.length > 0) {
        submissionData.tags = {
          create: tagIds.map((tagId) => ({
            tagId,
          })),
        };
      }

      const submissionPromise = prisma.memeSubmission.create({
        data: submissionData,
        include: tagIds.length > 0 ? {
          tags: {
            include: {
              tag: true,
            },
          },
        } : undefined,
      });
      
      const submissionTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Submission creation timeout')), 10000); // 10 second timeout
      });
      
      let submission: any;
      try {
        submission = await Promise.race([submissionPromise, submissionTimeout]);
      } catch (dbError: any) {
        // If error is about MemeSubmissionTag table, retry without tags
        if (dbError?.code === 'P2021' && dbError?.meta?.table === 'public.MemeSubmissionTag') {
          console.warn('MemeSubmissionTag table not found, creating submission without tags');
          submission = await prisma.memeSubmission.create({
            data: {
              channelId,
              submitterUserId: req.userId!,
              title: body.title,
              type: 'video',
              fileUrlTemp: `/uploads/${req.file.filename}`,
              notes: body.notes || null,
              status: 'pending',
            },
          });
        } else {
          throw dbError;
        }
      }

      // Send response immediately after creating submission
      res.status(201).json(submission);
    } catch (error: any) {
      console.error('Error in createSubmission:', {
        message: error?.message,
        name: error?.name,
        code: error?.code,
        stack: error?.stack,
        hasFile: !!req.file,
        fileSize: req.file?.size,
        channelId: req.channelId,
        userId: req.userId,
      });

      // Clean up uploaded file if it exists and error occurred
      if (req.file) {
        try {
          const filePath = path.join(process.cwd(), req.file.path);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log('Cleaned up uploaded file after error:', req.file.filename);
          }
        } catch (cleanupError) {
          console.error('Failed to clean up file after error:', cleanupError);
        }
      }

      // Handle specific error types
      if (error?.message === 'Submission creation timeout') {
        return res.status(408).json({ 
          error: 'Request timeout', 
          message: 'Submission creation timed out. Please try again.' 
        });
      }

      // Handle Prisma errors specifically
      if (error?.code === 'P2021' || error?.name === 'PrismaClientKnownRequestError') {
        console.error('Prisma database error - table may not exist:', error?.meta);
        if (!res.headersSent) {
          return res.status(500).json({
            error: 'Database error',
            message: 'A database error occurred. Please contact support if this persists.',
            details: process.env.NODE_ENV === 'development' ? error?.message : undefined,
          });
        }
        return;
      }

      // If response hasn't been sent, send error response
      if (!res.headersSent) {
        // Return error response instead of throwing to prevent hanging
        return res.status(500).json({
          error: 'Internal server error',
          message: error?.message || 'An unexpected error occurred',
          details: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
        });
      } else {
        // Response already sent, just log the error
        console.error('Error occurred after response was sent');
      }
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
    // Determine channelId: use from body/query if provided, otherwise use from token
    let channelId = req.body.channelId || req.query.channelId;
    if (!channelId) {
      channelId = req.channelId;
    }

    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID required' });
    }

    // Validate that the channel exists and user has access to it
    const channel = await prisma.channel.findUnique({
      where: { id: channelId as string },
    });

    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Check if user is the owner of this channel
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { channelId: true },
    });

    if (!user || user.channelId !== channelId) {
      // Log security event for unauthorized import attempt
      await logSecurityEvent(
        'unauthorized_access',
        req.userId!,
        channelId as string,
        {
          action: 'import_meme',
          attemptedChannelId: channelId,
          userChannelId: user?.channelId || null,
        },
        req
      );
      
      return res.status(403).json({ 
        error: 'Forbidden',
        message: 'You can only import memes to your own channel'
      });
    }

    try {
      const body = importMemeSchema.parse(req.body);

      // Validate URL is from memalerts.com or cdns.memealerts.com
      const isValidUrl = body.sourceUrl.includes('memalerts.com') || 
                        body.sourceUrl.includes('cdns.memealerts.com');
      if (!isValidUrl) {
        return res.status(400).json({ error: 'Source URL must be from memalerts.com or cdns.memealerts.com' });
      }

      // Get or create tags with timeout protection (same as createSubmission)
      let tagIds: string[] = [];
      try {
        const tagsPromise = getOrCreateTags(body.tags || []);
        const tagsTimeout = new Promise<string[]>((resolve) => {
          setTimeout(() => {
            console.warn('Tags creation timeout, proceeding without tags');
            resolve([]); // Proceed without tags if timeout
          }, 5000); // 5 second timeout for tags
        });
        tagIds = await Promise.race([tagsPromise, tagsTimeout]);
      } catch (error: any) {
        console.warn('Error creating tags, proceeding without tags:', error.message);
        tagIds = []; // Proceed without tags on error
      }

      // Create submission with imported URL (with timeout protection)
      const submissionData: any = {
        channelId,
        submitterUserId: req.userId!,
        title: body.title,
        type: 'video', // Imported memes are treated as video
        fileUrlTemp: body.sourceUrl, // Store source URL temporarily
        sourceUrl: body.sourceUrl,
        notes: body.notes || null,
        status: 'pending',
      };

      // Only add tags if we have tagIds
      if (tagIds.length > 0) {
        submissionData.tags = {
          create: tagIds.map((tagId) => ({
            tagId,
          })),
        };
      }

      const submissionPromise = prisma.memeSubmission.create({
        data: submissionData,
        include: tagIds.length > 0 ? {
          tags: {
            include: {
              tag: true,
            },
          },
        } : undefined,
      });
      
      const submissionTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Submission creation timeout')), 10000); // 10 second timeout
      });
      
      let submission: any;
      try {
        submission = await Promise.race([submissionPromise, submissionTimeout]);
      } catch (dbError: any) {
        // If error is about MemeSubmissionTag table, retry without tags
        if (dbError?.code === 'P2021' && dbError?.meta?.table === 'public.MemeSubmissionTag') {
          console.warn('MemeSubmissionTag table not found, creating submission without tags');
          submission = await prisma.memeSubmission.create({
            data: {
              channelId,
              submitterUserId: req.userId!,
              title: body.title,
              type: 'video',
              fileUrlTemp: body.sourceUrl,
              sourceUrl: body.sourceUrl,
              notes: body.notes || null,
              status: 'pending',
            },
          });
        } else if (dbError?.message === 'Submission creation timeout') {
          return res.status(408).json({ 
            error: 'Request timeout', 
            message: 'Submission creation timed out. Please try again.' 
          });
        } else {
          throw dbError;
        }
      }

      // Send response immediately after creating submission
      res.status(201).json(submission);
    } catch (error) {
      throw error;
    }
  },
};


