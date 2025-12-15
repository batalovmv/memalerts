import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { createSubmissionSchema } from '../shared/index.js';
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
      const body = createSubmissionSchema.parse(req.body);

      const submission = await prisma.memeSubmission.create({
        data: {
          channelId,
          submitterUserId: req.userId!,
          title: body.title,
          type: body.type,
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
};


