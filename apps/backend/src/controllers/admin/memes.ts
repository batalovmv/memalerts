import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { updateMemeSchema } from '../../shared/index.js';
import { logAdminAction } from '../../utils/auditLogger.js';

export const getMemes = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;

  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  // Perf: add safe pagination + lightweight selection to avoid unbounded payloads/joins.
  // Back-compat: response shape remains an array. Use headers for paging metadata.
  const clampInt = (n: number, min: number, max: number, fallback: number): number => {
    if (!Number.isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  };

  const all = String(req.query.all || '').toLowerCase();
  const includeTotal = String(req.query.includeTotal || '').toLowerCase() === '1';
  const qRaw = String(req.query.q || '').trim();
  const q = qRaw.length > 100 ? qRaw.slice(0, 100) : qRaw;

  const statusRaw = String(req.query.status || '').trim().toLowerCase();
  const allowedStatuses = new Set(['pending', 'approved', 'rejected', 'deleted']);

  const where: any = {
    channelId,
    ...(q
      ? {
          title: {
            contains: q,
            mode: 'insensitive',
          },
        }
      : {}),
  };

  // Default behavior: exclude deleted (but allow explicit status=deleted or status=all).
  if (statusRaw === 'all') {
    // no status filter
  } else if (allowedStatuses.has(statusRaw)) {
    where.status = statusRaw;
  } else {
    where.status = { not: 'deleted' };
  }

  // Default behavior: exclude soft-deleted rows. If explicitly querying deleted status, include them.
  if (where.status === 'deleted') {
    // include deletedAt
  } else {
    where.deletedAt = null;
  }

  const sortOrderRaw = String(req.query.sortOrder || '').toLowerCase();
  const sortOrder: 'asc' | 'desc' = sortOrderRaw === 'asc' ? 'asc' : 'desc';

  const maxFromEnv = parseInt(String(process.env.STREAMER_MEMES_MAX || ''), 10);
  const MAX_MEMES = Number.isFinite(maxFromEnv) && maxFromEnv > 0 ? maxFromEnv : 500;
  const requestedLimit = req.query.limit !== undefined ? parseInt(String(req.query.limit), 10) : undefined;
  const requestedOffset = req.query.offset !== undefined ? parseInt(String(req.query.offset), 10) : undefined;

  const limit = clampInt(requestedLimit as number, 1, MAX_MEMES, Math.min(200, MAX_MEMES));
  const offset = clampInt(requestedOffset as number, 0, 1_000_000_000, 0);

  // If all=1, preserve legacy behavior (no cap). Use with care.
  const usePaging = all !== '1' && all !== 'true' && all !== 'yes';

  const whereChannelMeme: any = {
    channelId,
    ...(q
      ? {
          title: {
            contains: q,
            mode: 'insensitive',
          },
        }
      : {}),
  };

  // Default behavior: exclude deleted (but allow explicit status=deleted or status=all).
  if (statusRaw === 'all') {
    // no status filter
  } else if (allowedStatuses.has(statusRaw)) {
    // Map legacy 'deleted' to channelMeme 'disabled' + deletedAt!=null semantics.
    if (statusRaw === 'deleted') {
      whereChannelMeme.status = 'disabled';
    } else {
      whereChannelMeme.status = statusRaw;
    }
  } else {
    whereChannelMeme.status = { not: 'disabled' };
  }

  // Default behavior: exclude soft-deleted rows. If explicitly querying deleted status, include them.
  if (statusRaw === 'deleted') {
    // include deletedAt
  } else {
    whereChannelMeme.deletedAt = null;
  }

  const rows = await prisma.channelMeme.findMany({
    where: whereChannelMeme,
    ...(usePaging ? { take: limit + 1, skip: offset } : {}),
    orderBy: { createdAt: sortOrder },
    select: {
      id: true,
      legacyMemeId: true,
      channelId: true,
      title: true,
      priceCoins: true,
      status: true,
      deletedAt: true,
      createdAt: true,
      memeAsset: {
        select: {
          id: true,
          type: true,
          fileUrl: true,
          durationMs: true,
          createdBy: {
            select: {
              id: true,
              displayName: true,
              channel: { select: { slug: true } },
            },
          },
        },
      },
      approvedBy: {
        select: {
          id: true,
          displayName: true,
        },
      },
    },
  });

  const memes = rows.map((r) => ({
    id: r.id, // channelMemeId (new)
    legacyMemeId: r.legacyMemeId,
    channelId: r.channelId,
    title: r.title,
    type: r.memeAsset.type,
    fileUrl: r.memeAsset.fileUrl,
    durationMs: r.memeAsset.durationMs,
    priceCoins: r.priceCoins,
    status: r.status,
    deletedAt: r.deletedAt,
    createdAt: r.createdAt,
    createdBy: r.memeAsset.createdBy,
    approvedBy: r.approvedBy,
  }));

  let hasMore = false;
  let items = memes;
  if (usePaging && memes.length > limit) {
    hasMore = true;
    items = memes.slice(0, limit);
  }

  if (usePaging) {
    res.setHeader('X-Limit', String(limit));
    res.setHeader('X-Offset', String(offset));
    res.setHeader('X-Has-More', hasMore ? '1' : '0');
  }

  if (includeTotal) {
    // Perf: counting can be expensive; opt-in only.
    const total = await prisma.channelMeme.count({ where: whereChannelMeme });
    res.setHeader('X-Total-Count', String(total));
  }

  res.json(items);
};

export const updateMeme = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const channelId = req.channelId;

  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  try {
    const body = updateMemeSchema.parse(req.body);

    // Primary: treat :id as ChannelMeme.id
    const cm = await prisma.channelMeme.findUnique({
      where: { id },
      include: { memeAsset: { include: { createdBy: { select: { id: true, displayName: true, channel: { select: { slug: true } } } } } }, approvedBy: { select: { id: true, displayName: true } } },
    });

    // Back-compat: allow legacy Meme.id (streamer panel not yet migrated)
    const cmByLegacy =
      !cm
        ? await prisma.channelMeme.findFirst({
            where: { legacyMemeId: id, channelId },
            include: { memeAsset: { include: { createdBy: { select: { id: true, displayName: true, channel: { select: { slug: true } } } } } }, approvedBy: { select: { id: true, displayName: true } } },
          })
        : null;

    const target = cm ?? cmByLegacy;
    if (!target) {
      return res.status(404).json({ errorCode: 'CHANNEL_MEME_NOT_FOUND', error: 'Meme not found', details: { entity: 'channelMeme', id } });
    }
    if (target.channelId !== channelId) {
      return res
        .status(403)
        .json({ errorCode: 'FORBIDDEN', error: 'Forbidden', details: { entity: 'channelMeme', id, channelId: target.channelId } });
    }

    const updated = await prisma.channelMeme.update({
      where: { id: target.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.priceCoins !== undefined ? { priceCoins: body.priceCoins } : {}),
        // durationMs intentionally ignored (asset is shared; channel edit should not mutate global asset)
      },
      include: {
        memeAsset: { include: { createdBy: { select: { id: true, displayName: true, channel: { select: { slug: true } } } } } },
        approvedBy: { select: { id: true, displayName: true } },
      },
    });

    // Back-compat: keep legacy Meme in sync so older read paths (public lists/search) reflect streamer edits.
    // Best-effort: do not fail the request if legacy row is missing.
    if (updated.legacyMemeId) {
      try {
        await prisma.meme.update({
          where: { id: updated.legacyMemeId },
          data: {
            ...(body.title !== undefined ? { title: body.title } : {}),
            ...(body.priceCoins !== undefined ? { priceCoins: body.priceCoins } : {}),
            // durationMs/fileUrl are asset-scoped; do not mutate here
          },
        });
      } catch (e) {
        // ignore
      }
    }

    res.json({
      id: updated.id,
      legacyMemeId: updated.legacyMemeId,
      channelId: updated.channelId,
      title: updated.title,
      type: updated.memeAsset.type,
      fileUrl: updated.memeAsset.fileUrl,
      durationMs: updated.memeAsset.durationMs,
      priceCoins: updated.priceCoins,
      status: updated.status,
      deletedAt: updated.deletedAt,
      createdAt: updated.createdAt,
      createdBy: updated.memeAsset.createdBy,
      approvedBy: updated.approvedBy,
    });
  } catch (error) {
    throw error;
  }
};

export const deleteMeme = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const channelId = req.channelId;

  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  try {
    const cm =
      (await prisma.channelMeme.findUnique({ where: { id } })) ??
      (await prisma.channelMeme.findFirst({ where: { legacyMemeId: id, channelId } }));

    if (!cm) {
      return res.status(404).json({ errorCode: 'CHANNEL_MEME_NOT_FOUND', error: 'Meme not found', details: { entity: 'channelMeme', id } });
    }
    if (cm.channelId !== channelId) {
      return res.status(403).json({ errorCode: 'FORBIDDEN', error: 'Forbidden', details: { entity: 'channelMeme', id, channelId: cm.channelId } });
    }

    // Soft delete: disable channel adoption
    const now = new Date();
    const deleted = await prisma.channelMeme.update({
      where: { id: cm.id },
      data: { status: 'disabled', deletedAt: now },
      include: {
        memeAsset: {
          include: {
            createdBy: {
              select: {
                id: true,
                displayName: true,
              },
            },
          },
        },
      },
    });

    // Back-compat: also soft-delete legacy Meme row if present, otherwise old endpoints keep returning the meme.
    if (deleted.legacyMemeId) {
      try {
        await prisma.meme.update({
          where: { id: deleted.legacyMemeId },
          data: {
            status: 'deleted',
            deletedAt: now,
          },
        });
      } catch (e) {
        // ignore
      }
    }

    // Log admin action
    await logAdminAction(
      'delete_meme',
      req.userId!,
      channelId,
      cm.id,
      {
        memeTitle: deleted.title,
      },
      true,
      req
    );

    res.json({
      id: deleted.id,
      legacyMemeId: deleted.legacyMemeId,
      channelId: deleted.channelId,
      title: deleted.title,
      type: deleted.memeAsset.type,
      fileUrl: deleted.memeAsset.fileUrl,
      durationMs: deleted.memeAsset.durationMs,
      priceCoins: deleted.priceCoins,
      status: deleted.status,
      deletedAt: deleted.deletedAt,
      createdAt: deleted.createdAt,
      createdBy: deleted.memeAsset.createdBy,
    });
  } catch (error: any) {
    console.error('Error in deleteMeme:', error);
    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to delete meme',
      });
    }
  }
};


