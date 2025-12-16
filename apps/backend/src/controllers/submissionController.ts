import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { createSubmissionSchema, importMemeSchema } from '../shared/index.js';
import path from 'path';

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

      const body = createSubmissionSchema.parse(req.body);

      // Ensure type is video
      if (body.type !== 'video') {
        return res.status(400).json({ error: 'Only video type is allowed' });
      }

      const submission = await prisma.memeSubmission.create({
        data: {
          channelId,
          submitterUserId: req.userId!,
          title: body.title,
          type: 'video', // Force video type
          fileUrlTemp: `/uploads/${req.file.filename}`,
          notes: body.notes || null,
          status: 'pending',
        },
      });

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

      // Validate URL is from memalerts.com
      if (!body.sourceUrl.includes('memalerts.com')) {
        return res.status(400).json({ error: 'Source URL must be from memalerts.com' });
      }

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
        },
      });

      res.status(201).json(submission);
    } catch (error) {
      throw error;
    }
  },
};


