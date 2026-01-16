import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog, getRequestMetadata } from '../../utils/auditLogger.js';

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function getDefaultQuarantineDays(): number {
  const raw = parseInt(String(process.env.MEME_ASSET_QUARANTINE_DAYS || ''), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 14;
}

type MemeAssetModerationRow = {
  poolHiddenReason?: string | null;
  poolHiddenByUserId?: string | null;
  purgeByUserId?: string | null;
  hiddenBy?: { id: string; displayName: string } | null;
  purgedBy?: { id: string; displayName: string } | null;
} & Record<string, unknown>;

function toMemeAssetModerationDto(row: MemeAssetModerationRow) {
  return {
    ...row,
    // Stable, UI-friendly aliases (keep existing poolHidden*/purge* fields for backward compatibility)
    hiddenReason: row.poolHiddenReason ?? null,
    hiddenByUserId: row.poolHiddenByUserId ?? null,
    purgeRequestedByUserId: row.purgeByUserId ?? null,
    hiddenBy: row.hiddenBy ?? null,
    purgeRequestedBy: row.purgedBy ?? null,
  };
}

export const moderationMemeAssetController = {
  // GET /moderation/meme-assets?status=hidden|quarantine|purged|all&q=...&limit=...&offset=...
  list: async (req: AuthRequest, res: Response) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const status = String(query.status || 'quarantine').toLowerCase();
    const qRaw = String(query.q || '').trim();
    const q = qRaw.length > 100 ? qRaw.slice(0, 100) : qRaw;

    const limitRaw = parseInt(String(query.limit ?? ''), 10);
    const offsetRaw = parseInt(String(query.offset ?? ''), 10);
    const limit = clampInt(Number.isFinite(limitRaw) ? limitRaw : 50, 1, 200, 50);
    const offset = clampInt(Number.isFinite(offsetRaw) ? offsetRaw : 0, 0, 1_000_000, 0);

    const where: Prisma.MemeAssetWhereInput = {};
    if (status === 'hidden') {
      where.poolVisibility = 'hidden';
      where.purgeRequestedAt = null;
      where.purgedAt = null;
    } else if (status === 'quarantine') {
      where.purgeRequestedAt = { not: null };
      where.purgedAt = null;
    } else if (status === 'purged') {
      where.purgedAt = { not: null };
    } else if (status === 'all') {
      // no additional filters
    } else {
      return res
        .status(400)
        .json({ errorCode: 'BAD_REQUEST', error: 'Invalid status filter', requestId: req.requestId });
    }

    // Simple search by fileHash or reason (best-effort).
    if (q) {
      where.OR = [
        { fileHash: { equals: q } },
        { poolHiddenReason: { contains: q, mode: 'insensitive' } },
        { purgeReason: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.memeAsset.count({ where }),
      prisma.memeAsset.findMany({
        where,
        // Deterministic ordering for stable pagination (avoid duplicates/skips when rows change).
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
        select: {
          id: true,
          type: true,
          fileUrl: true,
          fileHash: true,
          durationMs: true,
          createdAt: true,
          poolVisibility: true,
          poolHiddenAt: true,
          poolHiddenByUserId: true,
          poolHiddenReason: true,
          purgeRequestedAt: true,
          purgeNotBefore: true,
          purgedAt: true,
          purgeReason: true,
          purgeByUserId: true,
          hiddenBy: { select: { id: true, displayName: true } },
          purgedBy: { select: { id: true, displayName: true } },
        },
      }),
    ]);

    res.setHeader('X-Limit', String(limit));
    res.setHeader('X-Offset', String(offset));
    res.setHeader('X-Total', String(total));
    return res.json(rows.map(toMemeAssetModerationDto));
  },

  // POST /moderation/meme-assets/:id/hide  body: { reason?: string }
  hide: async (req: AuthRequest, res: Response) => {
    const id = String(req.params.id || '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = typeof body.reason === 'string' ? String(body.reason).slice(0, 500) : null;
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
          hiddenBy: { select: { id: true, displayName: true } },
        },
      });

      await auditLog({
        action: 'moderation.memeAsset.hide',
        actorId: req.userId!,
        payload: { memeAssetId: id, reason },
        ipAddress,
        userAgent,
        success: true,
      });
      return res.json(toMemeAssetModerationDto(updated));
    } catch (error) {
      await auditLog({
        action: 'moderation.memeAsset.hide',
        actorId: req.userId || null,
        payload: { memeAssetId: id, reason },
        ipAddress,
        userAgent,
        success: false,
        error: (error as Error).message,
      });
      return res.status(404).json({ errorCode: 'NOT_FOUND', error: 'Not found', requestId: req.requestId });
    }
  },

  // POST /moderation/meme-assets/:id/unhide
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
          purgeRequestedAt: true,
          purgeNotBefore: true,
          purgedAt: true,
          hiddenBy: { select: { id: true, displayName: true } },
          purgedBy: { select: { id: true, displayName: true } },
        },
      });

      await auditLog({
        action: 'moderation.memeAsset.unhide',
        actorId: req.userId!,
        payload: { memeAssetId: id },
        ipAddress,
        userAgent,
        success: true,
      });
      return res.json(toMemeAssetModerationDto(updated));
    } catch (error) {
      await auditLog({
        action: 'moderation.memeAsset.unhide',
        actorId: req.userId || null,
        payload: { memeAssetId: id },
        ipAddress,
        userAgent,
        success: false,
        error: (error as Error).message,
      });
      return res.status(404).json({ errorCode: 'NOT_FOUND', error: 'Not found', requestId: req.requestId });
    }
  },

  // POST /moderation/meme-assets/:id/delete  body: { reason?: string, days?: number }
  // "Delete" = quarantine (sets purgeRequestedAt/purgeNotBefore) + hide from pool immediately.
  // Final purge is performed by background job after purgeNotBefore (and can be restored by admin before/after).
  del: async (req: AuthRequest, res: Response) => {
    const id = String(req.params.id || '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = typeof body.reason === 'string' ? String(body.reason).slice(0, 500) : null;
    if (!reason) {
      return res
        .status(400)
        .json({ errorCode: 'VALIDATION_ERROR', error: 'Reason is required', requestId: req.requestId });
    }
    const daysRaw = body.days;
    const daysNum = typeof daysRaw === 'number' ? daysRaw : typeof daysRaw === 'string' ? parseInt(daysRaw, 10) : NaN;
    // Safety: keep a minimum window so the admin has time to review/restore.
    const days = clampInt(daysNum, 3, 90, getDefaultQuarantineDays());

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
          poolHiddenAt: true,
          poolHiddenByUserId: true,
          poolHiddenReason: true,
          purgeRequestedAt: true,
          purgeNotBefore: true,
          purgedAt: true,
          purgeReason: true,
          purgeByUserId: true,
          hiddenBy: { select: { id: true, displayName: true } },
          purgedBy: { select: { id: true, displayName: true } },
        },
      });

      await auditLog({
        action: 'moderation.memeAsset.delete',
        actorId: req.userId!,
        payload: { memeAssetId: id, days, purgeNotBefore, reason },
        ipAddress,
        userAgent,
        success: true,
      });
      return res.json(toMemeAssetModerationDto(updated));
    } catch (error) {
      await auditLog({
        action: 'moderation.memeAsset.delete',
        actorId: req.userId || null,
        payload: { memeAssetId: id, days, purgeNotBefore, reason },
        ipAddress,
        userAgent,
        success: false,
        error: (error as Error).message,
      });
      return res.status(404).json({ errorCode: 'NOT_FOUND', error: 'Not found', requestId: req.requestId });
    }
  },
};
