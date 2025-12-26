import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog, getRequestMetadata } from '../../utils/auditLogger.js';

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export const memeAssetModerationController = {
  // POST /owner/meme-assets/:id/hide
  hide: async (req: AuthRequest, res: Response) => {
    const id = String(req.params.id || '');
    const reason = typeof (req.body as any)?.reason === 'string' ? String((req.body as any).reason).slice(0, 500) : null;

    const { ipAddress, userAgent } = getRequestMetadata(req);

    try {
      const updated = await prisma.memeAsset.update({
        where: { id },
        data: {
          poolVisibility: 'hidden',
          poolHiddenAt: new Date(),
          poolHiddenByUserId: req.userId!,
          poolHiddenReason: reason,
        },
        select: {
          id: true,
          poolVisibility: true,
          poolHiddenAt: true,
          poolHiddenByUserId: true,
          poolHiddenReason: true,
        },
      });

      await auditLog({
        action: 'owner.memeAsset.hide',
        actorId: req.userId!,
        payload: { memeAssetId: id, reason },
        ipAddress,
        userAgent,
        success: true,
      });

      return res.json(updated);
    } catch (e: any) {
      await auditLog({
        action: 'owner.memeAsset.hide',
        actorId: req.userId || null,
        payload: { memeAssetId: id, reason },
        ipAddress,
        userAgent,
        success: false,
        error: e?.message,
      });
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
  },

  // POST /owner/meme-assets/:id/unhide
  unhide: async (req: AuthRequest, res: Response) => {
    const id = String(req.params.id || '');
    const { ipAddress, userAgent } = getRequestMetadata(req);

    try {
      const updated = await prisma.memeAsset.update({
        where: { id },
        data: {
          poolVisibility: 'visible',
          poolHiddenAt: null,
          poolHiddenByUserId: null,
          poolHiddenReason: null,
        },
        select: {
          id: true,
          poolVisibility: true,
          poolHiddenAt: true,
          poolHiddenByUserId: true,
          poolHiddenReason: true,
        },
      });

      await auditLog({
        action: 'owner.memeAsset.unhide',
        actorId: req.userId!,
        payload: { memeAssetId: id },
        ipAddress,
        userAgent,
        success: true,
      });

      return res.json(updated);
    } catch (e: any) {
      await auditLog({
        action: 'owner.memeAsset.unhide',
        actorId: req.userId || null,
        payload: { memeAssetId: id },
        ipAddress,
        userAgent,
        success: false,
        error: e?.message,
      });
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
  },

  // POST /owner/meme-assets/:id/purge
  // Sets quarantine (purgeNotBefore) and hides from pool immediately.
  purge: async (req: AuthRequest, res: Response) => {
    const id = String(req.params.id || '');
    const reason = typeof (req.body as any)?.reason === 'string' ? String((req.body as any).reason).slice(0, 500) : null;
    const daysRaw = (req.body as any)?.days;
    const daysNum = typeof daysRaw === 'number' ? daysRaw : typeof daysRaw === 'string' ? parseInt(daysRaw, 10) : NaN;
    const days = clampInt(daysNum, 1, 90, 7);

    const now = new Date();
    const purgeNotBefore = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const { ipAddress, userAgent } = getRequestMetadata(req);

    try {
      const updated = await prisma.memeAsset.update({
        where: { id },
        data: {
          poolVisibility: 'hidden',
          poolHiddenAt: now,
          poolHiddenByUserId: req.userId!,
          ...(reason ? { poolHiddenReason: reason } : {}),
          purgeRequestedAt: now,
          purgeNotBefore,
          purgeReason: reason,
          purgeByUserId: req.userId!,
        },
        select: {
          id: true,
          poolVisibility: true,
          purgeRequestedAt: true,
          purgeNotBefore: true,
          purgedAt: true,
          purgeReason: true,
          purgeByUserId: true,
        },
      });

      await auditLog({
        action: 'owner.memeAsset.purge',
        actorId: req.userId!,
        payload: { memeAssetId: id, days, purgeNotBefore, reason },
        ipAddress,
        userAgent,
        success: true,
      });

      return res.json(updated);
    } catch (e: any) {
      await auditLog({
        action: 'owner.memeAsset.purge',
        actorId: req.userId || null,
        payload: { memeAssetId: id, days, purgeNotBefore, reason },
        ipAddress,
        userAgent,
        success: false,
        error: e?.message,
      });
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
  },
};


