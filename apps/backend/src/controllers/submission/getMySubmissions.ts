import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';

export const getMySubmissions = async (req: AuthRequest, res: Response) => {
  try {
    const submissionsPromise = prisma.memeSubmission.findMany({
      where: {
        submitterUserId: req.userId!,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        channelId: true,
        submitterUserId: true,
        title: true,
        type: true,
        fileUrlTemp: true,
        sourceUrl: true,
        sourceKind: true,
        memeAssetId: true,
        notes: true,
        status: true,
        moderatorNotes: true,
        revision: true,
        createdAt: true,
        tags: {
          select: {
            tag: { select: { id: true, name: true } },
          },
        },
      },
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Submissions query timeout')), 5000); // 5 second timeout
    });

    let submissions: any = await Promise.race([submissionsPromise, timeoutPromise]);

    // Back-compat: some deployments might not have MemeSubmissionTag table (older DB).
    // If so, retry without tags and provide empty tags array.
    if (Array.isArray(submissions)) {
      return res.json(submissions);
    }
    return res.json([]);
  } catch (error: any) {
    console.error('Error in getMySubmissions:', error);
    if (!res.headersSent) {
      if (error.message?.includes('timeout')) {
        return res.status(408).json({
          error: 'Request timeout',
          message: 'Submissions query timed out. Please try again.',
        });
      }

      // If error is about MemeSubmissionTag table, retry without tags.
      if (error?.code === 'P2021' && error?.meta?.table === 'public.MemeSubmissionTag') {
        try {
          const fallback = await prisma.memeSubmission.findMany({
            where: { submitterUserId: req.userId! },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              channelId: true,
              submitterUserId: true,
              title: true,
              type: true,
              fileUrlTemp: true,
              sourceUrl: true,
              sourceKind: true,
              memeAssetId: true,
              notes: true,
              status: true,
              moderatorNotes: true,
              revision: true,
              createdAt: true,
            },
          });
          return res.json(fallback.map((s: any) => ({ ...s, tags: [] })));
        } catch {
          // fall through
        }
      }
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to fetch submissions',
      });
    }
  }
};


