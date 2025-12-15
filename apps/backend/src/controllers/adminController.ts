import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { approveSubmissionSchema, rejectSubmissionSchema, updateMemeSchema, updateChannelSettingsSchema } from '../shared';
import fs from 'fs';
import path from 'path';

export const adminController = {
  getSubmissions: async (req: AuthRequest, res: Response) => {
    const status = req.query.status as string | undefined;
    const channelId = req.channelId;

    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID required' });
    }

    const submissions = await prisma.memeSubmission.findMany({
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

    res.json(submissions);
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
        const submission = await tx.memeSubmission.findUnique({
          where: { id },
        });

        if (!submission || submission.channelId !== channelId) {
          throw new Error('Submission not found');
        }

        if (submission.status !== 'pending') {
          throw new Error('Submission already processed');
        }

        // Move file from temp to permanent location
        const tempPath = path.join(process.cwd(), submission.fileUrlTemp);
        const fileName = path.basename(submission.fileUrlTemp);
        const permanentPath = path.join(process.cwd(), 'uploads', 'memes', fileName);

        // Ensure memes directory exists
        const memesDir = path.join(process.cwd(), 'uploads', 'memes');
        if (!fs.existsSync(memesDir)) {
          fs.mkdirSync(memesDir, { recursive: true });
        }

        // Move file
        if (fs.existsSync(tempPath)) {
          fs.renameSync(tempPath, permanentPath);
        }

        // Update submission
        await tx.memeSubmission.update({
          where: { id },
          data: {
            status: 'approved',
          },
        });

        // Create meme
        const meme = await tx.meme.create({
          data: {
            channelId: submission.channelId,
            title: submission.title,
            type: submission.type,
            fileUrl: `/uploads/memes/${fileName}`,
            durationMs: body.durationMs,
            priceCoins: body.priceCoins,
            status: 'approved',
            createdByUserId: submission.submitterUserId,
            approvedByUserId: req.userId!,
          },
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
          moderatorNotes: body.moderatorNotes,
        },
      });

      // Optionally delete temp file
      const tempPath = path.join(process.cwd(), submission.fileUrlTemp);
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }

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
};


