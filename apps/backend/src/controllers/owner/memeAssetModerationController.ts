import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { auditLog, getRequestMetadata } from '../../utils/auditLogger.js';

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

type MemeAssetModerationRow = {
  status?: string | null;
};

function toMemeAssetModerationDto<T extends Record<string, unknown> & MemeAssetModerationRow>(row: T) {
  const status = String(row.status || '');
  const poolVisibility = status === 'hidden' ? 'hidden' : status === 'active' ? 'visible' : 'hidden';
  return { ...row, poolVisibility };
}

export const memeAssetModerationController = {
  // GET /owner/meme-assets?status=hidden|quarantine|purged|all&q=...&limit=...&offset=...
  list: async (req: AuthRequest, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const status = String(query.status || 'quarantine').toLowerCase();
    const qRaw = String(query.q || '').trim();
    const q = qRaw.length > 100 ? qRaw.slice(0, 100) : qRaw;

    const limitRaw = parseInt(String(query.limit ?? ''), 10);
    const offsetRaw = parseInt(String(query.offset ?? ''), 10);
    const limit = clampInt(Number.isFinite(limitRaw) ? limitRaw : 50, 1, 500, 50);
    const offset = clampInt(Number.isFinite(offsetRaw) ? offsetRaw : 0, 0, 1_000_000, 0);

    const where: Prisma.MemeAssetWhereInput = {};
    if (status === 'hidden') {
      where.status = 'hidden';
    } else if (status === 'quarantine') {
      where.status = 'quarantined';
    } else if (status === 'purged') {
      where.status = 'deleted';
    } else if (status === 'all') {
      // no extra filters
    } else {
      return res
        .status(400)
        .json({ errorCode: 'BAD_REQUEST', error: 'Invalid status filter', requestId: req.requestId });
    }

    if (q) {
      where.OR = [
        { fileHash: { equals: q } },
        { fileUrl: { contains: q, mode: 'insensitive' } },
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
          status: true,
          hiddenAt: true,
          quarantinedAt: true,
          deletedAt: true,
        },
      }),
    ]);

    res.setHeader('X-Limit', String(limit));
    res.setHeader('X-Offset', String(offset));
    res.setHeader('X-Total', String(total));
    return res.json(rows.map(toMemeAssetModerationDto));
  },

  // POST /owner/meme-assets/:id/hide
  hide: async (req: AuthRequest, res: Response) => {
    const id = String(req.params.id || '');
    const body = req.body as Record<string, unknown>;
    const reason = typeof body.reason === 'string' ? String(body.reason).slice(0, 500) : null;

    const { ipAddress, userAgent } = getRequestMetadata(req);

    try {
      const updated = await prisma.memeAsset.update({
        where: { id },
        data: {
          status: 'hidden',
          hiddenAt: new Date(),
        },
        select: {
          id: true,
          status: true,
          hiddenAt: true,
          quarantinedAt: true,
          deletedAt: true,
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

      return res.json(toMemeAssetModerationDto(updated));
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      await auditLog({
        action: 'owner.memeAsset.hide',
        actorId: req.userId || null,
        payload: { memeAssetId: id, reason },
        ipAddress,
        userAgent,
        success: false,
        error: errorMessage,
      });
      return res.status(404).json({ errorCode: 'NOT_FOUND', error: 'Not found', requestId: req.requestId });
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
          status: 'active',
          hiddenAt: null,
        },
        select: {
          id: true,
          status: true,
          hiddenAt: true,
          quarantinedAt: true,
          deletedAt: true,
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

      return res.json(toMemeAssetModerationDto(updated));
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      await auditLog({
        action: 'owner.memeAsset.unhide',
        actorId: req.userId || null,
        payload: { memeAssetId: id },
        ipAddress,
        userAgent,
        success: false,
        error: errorMessage,
      });
      return res.status(404).json({ errorCode: 'NOT_FOUND', error: 'Not found', requestId: req.requestId });
    }
  },

  // POST /owner/meme-assets/:id/purge
    // Marks asset deleted and hides it immediately.
  purge: async (req: AuthRequest, res: Response) => {
    const id = String(req.params.id || '');
    const body = req.body as Record<string, unknown>;
    const reason = typeof body.reason === 'string' ? String(body.reason).slice(0, 500) : null;
    const daysRaw = body.days;
    const daysNum = typeof daysRaw === 'number' ? daysRaw : typeof daysRaw === 'string' ? parseInt(daysRaw, 10) : NaN;
    const days = clampInt(daysNum, 1, 90, 7);

    const now = new Date();

    const { ipAddress, userAgent } = getRequestMetadata(req);

    try {
      const updated = await prisma.memeAsset.update({
        where: { id },
        data: {
          status: 'deleted',
          deletedAt: now,
          hiddenAt: now,
        },
        select: {
          id: true,
          status: true,
          hiddenAt: true,
          quarantinedAt: true,
          deletedAt: true,
        },
      });

      await auditLog({
        action: 'owner.memeAsset.purge',
        actorId: req.userId!,
        payload: { memeAssetId: id, days, reason },
        ipAddress,
        userAgent,
        success: true,
      });

      return res.json(toMemeAssetModerationDto(updated));
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      await auditLog({
        action: 'owner.memeAsset.purge',
        actorId: req.userId || null,
        payload: { memeAssetId: id, days, reason },
        ipAddress,
        userAgent,
        success: false,
        error: errorMessage,
      });
      return res.status(404).json({ errorCode: 'NOT_FOUND', error: 'Not found', requestId: req.requestId });
    }
  },

  // POST /owner/meme-assets/:id/restore
  // Restores visibility AND clears quarantine fields (safe undo).
  // Note: this does not touch ChannelMeme state; streamers manage their channel memes separately.
  restore: async (req: AuthRequest, res: Response) => {
    const id = String(req.params.id || '');
    const { ipAddress, userAgent } = getRequestMetadata(req);

    try {
      const updated = await prisma.memeAsset.update({
        where: { id },
        data: {
          status: 'active',
          hiddenAt: null,
          quarantinedAt: null,
          deletedAt: null,
        },
        select: {
          id: true,
          status: true,
          hiddenAt: true,
          quarantinedAt: true,
          deletedAt: true,
        },
      });

      await auditLog({
        action: 'owner.memeAsset.restore',
        actorId: req.userId!,
        payload: { memeAssetId: id },
        ipAddress,
        userAgent,
        success: true,
      });

      return res.json(toMemeAssetModerationDto(updated));
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      await auditLog({
        action: 'owner.memeAsset.restore',
        actorId: req.userId || null,
        payload: { memeAssetId: id },
        ipAddress,
        userAgent,
        success: false,
        error: errorMessage,
      });
      return res.status(404).json({ errorCode: 'NOT_FOUND', error: 'Not found', requestId: req.requestId });
    }
  },
};
