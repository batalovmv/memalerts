import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { invalidateBetaAccessCache } from '../../middleware/betaAccess.js';
import { auditLog, getRequestMetadata } from '../../utils/auditLogger.js';
import { logger } from '../../utils/logger.js';
import { getErrorMessage } from './betaAccessShared.js';

export async function getAllRequests(req: AuthRequest, res: Response) {
  try {
    const { userRole } = req;

    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
    }

    const requests = await prisma.betaAccess.findMany({
      where: {
        status: { in: ['pending', 'approved', 'rejected'] },
      },
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
  } catch (error: unknown) {
    logger.error('beta_access.list_failed', { errorMessage: getErrorMessage(error) });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function approveRequest(req: AuthRequest, res: Response) {
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

    invalidateBetaAccessCache(betaAccess.userId);

    return res.json({
      message: 'Beta access approved',
      request: {
        ...betaAccess,
        status: 'approved',
        approvedAt: new Date(),
        approvedBy: userId,
      },
    });
  } catch (error: unknown) {
    logger.error('beta_access.approve_failed', { errorMessage: getErrorMessage(error) });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function rejectRequest(req: AuthRequest, res: Response) {
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
  } catch (error: unknown) {
    logger.error('beta_access.reject_failed', { errorMessage: getErrorMessage(error) });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getGrantedUsers(req: AuthRequest, res: Response) {
  try {
    if (req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
    }

    const users = await prisma.user.findMany({
      where: { hasBetaAccess: true },
      select: {
        id: true,
        displayName: true,
        twitchUserId: true,
        role: true,
        hasBetaAccess: true,
        createdAt: true,
        betaAccess: {
          select: {
            id: true,
            status: true,
            requestedAt: true,
            approvedAt: true,
            approvedBy: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(users);
  } catch (error: unknown) {
    logger.error('beta_access.granted_list_failed', { errorMessage: getErrorMessage(error) });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getRevokedUsers(req: AuthRequest, res: Response) {
  try {
    if (req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
    }

    const revoked = await prisma.betaAccess.findMany({
      where: { status: 'revoked' },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            twitchUserId: true,
            role: true,
            hasBetaAccess: true,
            createdAt: true,
          },
        },
      },
      orderBy: { approvedAt: 'desc' },
    });

    return res.json(revoked);
  } catch (error: unknown) {
    logger.error('beta_access.revoked_list_failed', { errorMessage: getErrorMessage(error) });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function revokeUserAccess(req: AuthRequest, res: Response) {
  const { userId: actorId, userRole } = req;
  if (userRole !== 'admin') {
    return res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
  }

  const { userId } = req.params as { userId?: string };
  if (!userId) {
    return res.status(400).json({ error: 'Bad Request', message: 'Missing userId' });
  }

  try {
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true, hasBetaAccess: true },
    });

    if (!target) {
      return res.status(404).json({ error: 'Not Found', message: 'User not found' });
    }

    if (!target.hasBetaAccess) {
      invalidateBetaAccessCache(userId);
      return res.status(200).json({ message: 'User already has no beta access' });
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { hasBetaAccess: false },
      }),
      prisma.betaAccess.upsert({
        where: { userId },
        create: {
          userId,
          status: 'revoked',
          approvedAt: new Date(),
          approvedBy: actorId || null,
        },
        update: {
          status: 'revoked',
          approvedAt: new Date(),
          approvedBy: actorId || null,
        },
      }),
    ]);

    invalidateBetaAccessCache(userId);

    const { ipAddress, userAgent } = getRequestMetadata(req);
    await auditLog({
      action: 'beta_access.revoke',
      actorId: actorId || null,
      channelId: undefined,
      payload: {
        targetUserId: target.id,
        targetDisplayName: target.displayName,
        previousHasBetaAccess: true,
      },
      ipAddress,
      userAgent,
      success: true,
    });

    return res.json({ message: 'Beta access revoked', userId: target.id });
  } catch (error: unknown) {
    logger.error('beta_access.revoke_failed', { errorMessage: getErrorMessage(error) });
    const { ipAddress, userAgent } = getRequestMetadata(req);
    await auditLog({
      action: 'beta_access.revoke',
      actorId: actorId || null,
      channelId: undefined,
      payload: { targetUserId: userId },
      ipAddress,
      userAgent,
      success: false,
      error: getErrorMessage(error),
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function restoreUserAccess(req: AuthRequest, res: Response) {
  const { userId: actorId, userRole } = req;
  if (userRole !== 'admin') {
    return res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
  }

  const { userId } = req.params as { userId?: string };
  if (!userId) {
    return res.status(400).json({ error: 'Bad Request', message: 'Missing userId' });
  }

  try {
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true, hasBetaAccess: true },
    });

    if (!target) {
      return res.status(404).json({ error: 'Not Found', message: 'User not found' });
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { hasBetaAccess: true },
      }),
      prisma.betaAccess.upsert({
        where: { userId },
        create: {
          userId,
          status: 'approved',
          approvedAt: new Date(),
          approvedBy: actorId || null,
        },
        update: {
          status: 'approved',
          approvedAt: new Date(),
          approvedBy: actorId || null,
        },
      }),
    ]);

    invalidateBetaAccessCache(userId);

    const { ipAddress, userAgent } = getRequestMetadata(req);
    await auditLog({
      action: 'beta_access.restore',
      actorId: actorId || null,
      channelId: undefined,
      payload: {
        targetUserId: target.id,
        targetDisplayName: target.displayName,
        previousHasBetaAccess: target.hasBetaAccess,
      },
      ipAddress,
      userAgent,
      success: true,
    });

    return res.json({ message: 'Beta access restored', userId: target.id });
  } catch (error: unknown) {
    logger.error('beta_access.restore_failed', { errorMessage: getErrorMessage(error) });
    const { ipAddress, userAgent } = getRequestMetadata(req);
    await auditLog({
      action: 'beta_access.restore',
      actorId: actorId || null,
      channelId: undefined,
      payload: { targetUserId: userId },
      ipAddress,
      userAgent,
      success: false,
      error: getErrorMessage(error),
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
}
