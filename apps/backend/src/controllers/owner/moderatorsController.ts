import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog, getRequestMetadata } from '../../utils/auditLogger.js';

export const moderatorsController = {
  // GET /owner/moderators
  list: async (req: AuthRequest, res: Response) => {
    const rows = await prisma.globalModerator.findMany({
      orderBy: { grantedAt: 'desc' },
      select: {
        id: true,
        userId: true,
        grantedAt: true,
        grantedByUserId: true,
        revokedAt: true,
        revokedByUserId: true,
        user: { select: { id: true, displayName: true, twitchUserId: true } },
        grantedBy: { select: { id: true, displayName: true } },
        revokedBy: { select: { id: true, displayName: true } },
      },
    });
    return res.json(
      rows.map((r) => ({
        ...r,
        active: !r.revokedAt,
      }))
    );
  },

  // POST /owner/moderators/:userId/grant
  grant: async (req: AuthRequest, res: Response) => {
    const userId = String(req.params.userId || '');
    const { ipAddress, userAgent } = getRequestMetadata(req);

    try {
      const row = await prisma.globalModerator.upsert({
        where: { userId },
        create: {
          userId,
          grantedByUserId: req.userId!,
          grantedAt: new Date(),
          revokedAt: null,
          revokedByUserId: null,
        },
        update: {
          revokedAt: null,
          revokedByUserId: null,
          grantedByUserId: req.userId!,
          grantedAt: new Date(),
        },
        select: {
          id: true,
          userId: true,
          grantedAt: true,
          grantedByUserId: true,
          revokedAt: true,
          revokedByUserId: true,
        },
      });

      await auditLog({
        action: 'owner.moderators.grant',
        actorId: req.userId!,
        payload: { userId },
        ipAddress,
        userAgent,
        success: true,
      });

      return res.json(row);
    } catch (e: any) {
      await auditLog({
        action: 'owner.moderators.grant',
        actorId: req.userId || null,
        payload: { userId },
        ipAddress,
        userAgent,
        success: false,
        error: e?.message,
      });
      return res.status(400).json({ errorCode: 'BAD_REQUEST', error: 'Bad request', requestId: req.requestId });
    }
  },

  // POST /owner/moderators/:userId/revoke
  revoke: async (req: AuthRequest, res: Response) => {
    const userId = String(req.params.userId || '');
    const { ipAddress, userAgent } = getRequestMetadata(req);

    try {
      const row = await prisma.globalModerator.upsert({
        where: { userId },
        create: {
          userId,
          grantedByUserId: req.userId!,
          grantedAt: new Date(),
          revokedAt: new Date(),
          revokedByUserId: req.userId!,
        },
        update: {
          revokedAt: new Date(),
          revokedByUserId: req.userId!,
        },
        select: {
          id: true,
          userId: true,
          grantedAt: true,
          grantedByUserId: true,
          revokedAt: true,
          revokedByUserId: true,
        },
      });

      await auditLog({
        action: 'owner.moderators.revoke',
        actorId: req.userId!,
        payload: { userId },
        ipAddress,
        userAgent,
        success: true,
      });

      return res.json(row);
    } catch (e: any) {
      await auditLog({
        action: 'owner.moderators.revoke',
        actorId: req.userId || null,
        payload: { userId },
        ipAddress,
        userAgent,
        success: false,
        error: e?.message,
      });
      return res.status(400).json({ errorCode: 'BAD_REQUEST', error: 'Bad request', requestId: req.requestId });
    }
  },
};


