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

function buildAiSearchText(args: {
  title?: string | null;
  tagNames?: string[];
  description?: string | null;
  transcript?: string | null;
}): string | null {
  const parts = [
    args.title ? String(args.title) : '',
    Array.isArray(args.tagNames) && args.tagNames.length > 0 ? args.tagNames.join(' ') : '',
    args.description ? String(args.description) : '',
    args.transcript ? String(args.transcript) : '',
  ]
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  const merged = parts.join('\n');
  return merged ? merged.slice(0, 4000) : null;
}

type MemeAssetModerationRow = {
  status?: string | null;
} & Record<string, unknown>;

function toMemeAssetModerationDto(row: MemeAssetModerationRow) {
  const status = String(row.status || '');
  const poolVisibility = status === 'hidden' ? 'hidden' : status === 'active' ? 'visible' : 'hidden';
  return { ...row, poolVisibility };
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
      where.status = 'hidden';
    } else if (status === 'quarantine') {
      where.status = 'quarantined';
    } else if (status === 'purged') {
      where.status = 'deleted';
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
  // Marks asset deleted and hides it immediately.
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
        action: 'moderation.memeAsset.delete',
        actorId: req.userId!,
        payload: { memeAssetId: id, days, reason },
        ipAddress,
        userAgent,
        success: true,
      });
      return res.json(toMemeAssetModerationDto(updated));
    } catch (error) {
      await auditLog({
        action: 'moderation.memeAsset.delete',
        actorId: req.userId || null,
        payload: { memeAssetId: id, days, reason },
        ipAddress,
        userAgent,
        success: false,
        error: (error as Error).message,
      });
      return res.status(404).json({ errorCode: 'NOT_FOUND', error: 'Not found', requestId: req.requestId });
    }
  },

  // POST /moderation/meme-assets/:id/title  body: { title?: string | null }
  rename: async (req: AuthRequest, res: Response) => {
    const id = String(req.params.id || '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const titleRaw =
      typeof body.title === 'string'
        ? body.title
        : typeof body.aiAutoTitle === 'string'
          ? body.aiAutoTitle
          : '';
    const title = String(titleRaw || '').trim().slice(0, 200) || null;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    try {
      const existing = await prisma.memeAsset.findUnique({
        where: { id },
        select: {
          aiAutoTagNames: true,
          aiAutoDescription: true,
          aiTranscript: true,
        },
      });
      if (!existing) {
        await auditLog({
          action: 'moderation.memeAsset.rename',
          actorId: req.userId || null,
          payload: { memeAssetId: id, title },
          ipAddress,
          userAgent,
          success: false,
          error: 'Not found',
        });
        return res.status(404).json({ errorCode: 'NOT_FOUND', error: 'Not found', requestId: req.requestId });
      }

      const tagNames = Array.isArray(existing.aiAutoTagNames)
        ? existing.aiAutoTagNames.filter((tag) => typeof tag === 'string' && tag.trim().length > 0)
        : [];
      const aiSearchText = buildAiSearchText({
        title,
        tagNames,
        description: typeof existing.aiAutoDescription === 'string' ? existing.aiAutoDescription : null,
        transcript: typeof existing.aiTranscript === 'string' ? existing.aiTranscript : null,
      });

      const updated = await prisma.memeAsset.update({
        where: { id },
        data: {
          aiAutoTitle: title,
          aiSearchText,
        },
        select: {
          id: true,
          aiAutoTitle: true,
          aiSearchText: true,
        },
      });

      await auditLog({
        action: 'moderation.memeAsset.rename',
        actorId: req.userId!,
        payload: { memeAssetId: id, title },
        ipAddress,
        userAgent,
        success: true,
      });

      return res.json(updated);
    } catch (error) {
      await auditLog({
        action: 'moderation.memeAsset.rename',
        actorId: req.userId || null,
        payload: { memeAssetId: id, title },
        ipAddress,
        userAgent,
        success: false,
        error: (error as Error).message,
      });
      return res.status(500).json({ errorCode: 'INTERNAL_ERROR', error: 'Internal error', requestId: req.requestId });
    }
  },
};
