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

      // Validate video file (duration and size) with timeout protection
      const filePath = path.join(process.cwd(), req.file.path);
      
      // Start validation with timeout
      const validationPromise = validateVideo(filePath);
      const timeoutPromise = new Promise<{ valid: boolean; error?: string }>((resolve) => {
        setTimeout(() => {
          console.warn('Video validation timeout, allowing upload to proceed');
          resolve({ valid: true }); // Allow upload if validation times out
        }, 8000); // 8 second timeout for validation
      });
      
      const validation = await Promise.race([validationPromise, timeoutPromise]);
      
      if (!validation.valid) {
        // Delete uploaded file if validation fails
        try {
          fs.unlinkSync(filePath);
        } catch (unlinkError) {
          console.error('Failed to delete invalid video file:', unlinkError);
        }
        return res.status(400).json({ error: validation.error || 'Video validation failed' });
      }

      // Get or create tags (optimize by batching)
      const tagIds = await getOrCreateTags(body.tags || []);

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

      // Send response immediately after creating submission
      res.status(201).json(submission);
    } catch (error) {
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


