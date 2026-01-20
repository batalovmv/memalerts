import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { debugLog, debugError } from '../../utils/debug.js';
import { logger } from '../../utils/logger.js';
import { getErrorMessage } from './betaAccessShared.js';

export async function requestAccess(req: AuthRequest, res: Response) {
  try {
    const { userId } = req;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { hasBetaAccess: true },
    });

    if (user?.hasBetaAccess) {
      return res.status(400).json({ error: 'You already have beta access' });
    }

    const existingRequest = await prisma.betaAccess.findUnique({
      where: { userId },
    });

    if (existingRequest) {
      if (existingRequest.status === 'revoked') {
        return res.status(403).json({ error: 'Forbidden', message: 'Beta access revoked by administrator' });
      }

      if (existingRequest.status === 'pending') {
        return res.status(400).json({
          error: 'Request already exists',
          status: existingRequest.status,
        });
      }

      const refreshed = await prisma.betaAccess.update({
        where: { userId },
        data: {
          status: 'pending',
          requestedAt: new Date(),
          approvedAt: null,
          approvedBy: null,
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

      return res.status(200).json({
        message: 'Beta access request submitted',
        request: refreshed,
      });
    }

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
  } catch (error: unknown) {
    logger.error('beta_access.request_failed', { errorMessage: getErrorMessage(error) });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getStatus(req: AuthRequest, res: Response) {
  try {
    debugLog('[DEBUG] getStatus started', { userId: req.userId });
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
    debugLog('[DEBUG] getStatus user query completed', { userId, found: !!user, userDuration });

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
    debugLog('[DEBUG] getStatus betaAccess query completed', { userId, found: !!betaAccess, betaDuration });

    const response = {
      hasAccess: user?.hasBetaAccess || false,
      request: betaAccess,
    };
    debugLog('[DEBUG] getStatus sending response', { userId, hasAccess: response.hasAccess });
    return res.json(response);
  } catch (error: unknown) {
    debugError('[DEBUG] getStatus error', error);
    logger.error('beta_access.status_failed', { errorMessage: getErrorMessage(error) });
    return res.status(500).json({ error: 'Internal server error' });
  }
}
