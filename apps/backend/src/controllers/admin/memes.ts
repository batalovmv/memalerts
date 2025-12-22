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

  const memes = await prisma.meme.findMany({
    where,
    ...(usePaging ? { take: limit + 1, skip: offset } : {}),
    orderBy: { createdAt: sortOrder },
    select: {
      id: true,
      channelId: true,
      title: true,
      type: true,
      fileUrl: true,
      durationMs: true,
      priceCoins: true,
      status: true,
      createdAt: true,
      createdBy: {
        select: {
          id: true,
          displayName: true,
          channel: { select: { slug: true } },
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
    const total = await prisma.meme.count({ where });
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

    const meme = await prisma.meme.findUnique({
      where: { id },
    });

    if (!meme || meme.channelId !== channelId) {
      return res.status(404).json({ error: 'Meme not found' });
    }

    const updated = await prisma.meme.update({
      where: { id },
      data: body,
      include: {
        createdBy: {
          select: {
            id: true,
            displayName: true,
            channel: {
              select: {
                slug: true,
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

    res.json(updated);
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
    const meme = await prisma.meme.findUnique({
      where: { id },
    });

    if (!meme || meme.channelId !== channelId) {
      return res.status(404).json({ error: 'Meme not found' });
    }

    // Soft delete: change status to 'deleted'
    const deleted = await prisma.meme.update({
      where: { id },
      data: { status: 'deleted' },
      include: {
        createdBy: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
    });

    // Log admin action
    await logAdminAction(
      'delete_meme',
      req.userId!,
      channelId,
      id,
      {
        memeTitle: meme.title,
      },
      true,
      req
    );

    res.json(deleted);
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


