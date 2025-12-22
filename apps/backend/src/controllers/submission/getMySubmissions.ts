import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';

export const getMySubmissions = async (req: AuthRequest, res: Response) => {
  try {
    // Add timeout protection for submissions query
    const submissionsPromise = prisma.memeSubmission.findMany({
      where: {
        submitterUserId: req.userId!,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Submissions query timeout')), 5000); // 5 second timeout
    });

    const submissions = await Promise.race([submissionsPromise, timeoutPromise]);
    res.json(submissions);
  } catch (error: any) {
    console.error('Error in getMySubmissions:', error);
    if (!res.headersSent) {
      if (error.message?.includes('timeout')) {
        return res.status(408).json({
          error: 'Request timeout',
          message: 'Submissions query timed out. Please try again.',
        });
      }
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to fetch submissions',
      });
    }
  }
};


