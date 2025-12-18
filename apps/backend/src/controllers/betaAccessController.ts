import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';

export const betaAccessController = {
  // Request beta access
  requestAccess: async (req: AuthRequest, res: Response) => {
    try {
      const { userId } = req;

      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Check if user already has access
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { hasBetaAccess: true },
      });

      if (user?.hasBetaAccess) {
        return res.status(400).json({ error: 'You already have beta access' });
      }

      // Check if request already exists
      const existingRequest = await prisma.betaAccess.findUnique({
        where: { userId },
      });

      if (existingRequest) {
        return res.status(400).json({
          error: 'Request already exists',
          status: existingRequest.status,
        });
      }

      // Create new request
      const betaAccess = await prisma.betaAccess.create({
        data: {
          userId,
          status: 'pending',
        },
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
              twitchUserId: true,
            },
          },
        },
      });

      return res.status(201).json({
        message: 'Beta access request submitted',
        request: betaAccess,
      });
    } catch (error: any) {
      console.error('Error requesting beta access:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get user's beta access status
  getStatus: async (req: AuthRequest, res: Response) => {
    try {
      // #region agent log
      console.log('[DEBUG] getStatus started', JSON.stringify({ location: 'betaAccessController.ts:65', message: 'getStatus started', data: { userId: req.userId }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' }));
      // #endregion
      const { userId } = req;

      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const startTime = Date.now();
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { hasBetaAccess: true },
      });
      const userDuration = Date.now() - startTime;
      // #region agent log
      console.log('[DEBUG] getStatus user query completed', JSON.stringify({ location: 'betaAccessController.ts:78', message: 'getStatus user query completed', data: { userId, found: !!user, userDuration }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' }));
      // #endregion

      const betaStartTime = Date.now();
      const betaAccess = await prisma.betaAccess.findUnique({
        where: { userId },
        select: {
          id: true,
          status: true,
          requestedAt: true,
          approvedAt: true,
        },
      });
      const betaDuration = Date.now() - betaStartTime;
      // #region agent log
      console.log('[DEBUG] getStatus betaAccess query completed', JSON.stringify({ location: 'betaAccessController.ts:87', message: 'getStatus betaAccess query completed', data: { userId, found: !!betaAccess, betaDuration }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' }));
      // #endregion

      const response = {
        hasAccess: user?.hasBetaAccess || false,
        request: betaAccess,
      };
      // #region agent log
      console.log('[DEBUG] getStatus sending response', JSON.stringify({ location: 'betaAccessController.ts:92', message: 'getStatus sending response', data: { userId, hasAccess: response.hasAccess }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' }));
      // #endregion
      return res.json(response);
    } catch (error: any) {
      // #region agent log
      console.log('[DEBUG] getStatus error', JSON.stringify({ location: 'betaAccessController.ts:95', message: 'getStatus error', data: { userId: req.userId, error: error.message }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' }));
      // #endregion
      console.error('Error getting beta access status:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get all beta access requests (admin only)
  getAllRequests: async (req: AuthRequest, res: Response) => {
    try {
      const { userRole } = req;

      if (userRole !== 'admin') {
        return res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
      }

      const requests = await prisma.betaAccess.findMany({
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
              twitchUserId: true,
              role: true,
              createdAt: true,
            },
          },
        },
        orderBy: {
          requestedAt: 'desc',
        },
      });

      return res.json(requests);
    } catch (error: any) {
      console.error('Error getting beta access requests:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Approve beta access request (admin only)
  approveRequest: async (req: AuthRequest, res: Response) => {
    try {
      const { userRole, userId } = req;

      if (userRole !== 'admin') {
        return res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
      }

      const { id } = req.params;

      const betaAccess = await prisma.betaAccess.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
            },
          },
        },
      });

      if (!betaAccess) {
        return res.status(404).json({ error: 'Request not found' });
      }

      if (betaAccess.status === 'approved') {
        return res.status(400).json({ error: 'Request already approved' });
      }

      // Update beta access and user
      await prisma.$transaction([
        prisma.betaAccess.update({
          where: { id },
          data: {
            status: 'approved',
            approvedAt: new Date(),
            approvedBy: userId!,
          },
        }),
        prisma.user.update({
          where: { id: betaAccess.userId },
          data: {
            hasBetaAccess: true,
          },
        }),
      ]);

      return res.json({
        message: 'Beta access approved',
        request: {
          ...betaAccess,
          status: 'approved',
          approvedAt: new Date(),
          approvedBy: userId,
        },
      });
    } catch (error: any) {
      console.error('Error approving beta access:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Reject beta access request (admin only)
  rejectRequest: async (req: AuthRequest, res: Response) => {
    try {
      const { userRole, userId } = req;

      if (userRole !== 'admin') {
        return res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
      }

      const { id } = req.params;

      const betaAccess = await prisma.betaAccess.findUnique({
        where: { id },
      });

      if (!betaAccess) {
        return res.status(404).json({ error: 'Request not found' });
      }

      if (betaAccess.status === 'rejected') {
        return res.status(400).json({ error: 'Request already rejected' });
      }

      // Update beta access status
      const updated = await prisma.betaAccess.update({
        where: { id },
        data: {
          status: 'rejected',
          approvedAt: new Date(),
          approvedBy: userId!,
        },
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
            },
          },
        },
      });

      return res.json({
        message: 'Beta access rejected',
        request: updated,
      });
    } catch (error: any) {
      console.error('Error rejecting beta access:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  },
};

