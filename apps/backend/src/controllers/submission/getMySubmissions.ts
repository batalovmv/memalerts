import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import {
  DEFAULT_CURSOR_SCHEMA,
  PaginationError,
  buildCursorFilter,
  encodeCursorFromItem,
  mergeCursorWhere,
  parseLimit,
  safeDecodeCursor,
} from '../../utils/pagination.js';
import { ERROR_CODES } from '../../shared/errors.js';
import { logger } from '../../utils/logger.js';

export const getMySubmissions = async (req: AuthRequest, res: Response) => {
  const allowedStatuses = new Set(['pending', 'approved', 'rejected', 'needs_changes']);
  let limit = 50;
  let cursor: Record<string, unknown> | null = null;
  let where: Record<string, unknown> = {};
  try {
    const statusRaw = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : '';
    const status = statusRaw ? (allowedStatuses.has(statusRaw) ? statusRaw : null) : undefined;

    if (status === null) {
      return res.status(400).json({
        errorCode: ERROR_CODES.BAD_REQUEST,
        error: 'Bad Request',
        message: `Invalid status. Allowed: ${Array.from(allowedStatuses).join(', ')}`,
      });
    }
    try {
      limit = parseLimit(req.query.limit, { defaultLimit: 50, maxLimit: 100 });
      cursor = safeDecodeCursor(req.query.cursor, DEFAULT_CURSOR_SCHEMA);
    } catch (error) {
      if (error instanceof PaginationError) {
        return res.status(error.status).json({
          errorCode: error.errorCode,
          error: error.message,
          details: error.details,
        });
      }
      throw error;
    }

    const baseWhere = {
      submitterUserId: req.userId!,
      ...(status ? { status } : {}),
    };
    const cursorFilter = cursor ? buildCursorFilter(DEFAULT_CURSOR_SCHEMA, cursor) : null;
    where = mergeCursorWhere(baseWhere, cursorFilter);

    const submissionsPromise = prisma.memeSubmission.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        channelId: true,
        submitterUserId: true,
        title: true,
        type: true,
        fileUrlTemp: true,
        sourceUrl: true,
        sourceKind: true,
        memeAssetId: true,
        notes: true,
        status: true,
        moderatorNotes: true,
        revision: true,
        createdAt: true,
        memeAsset: {
          select: { fileUrl: true },
        },
        tags: {
          select: {
            tag: { select: { id: true, name: true } },
          },
        },
      },
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Submissions query timeout')), 5000); // 5 second timeout
    });

    let submissions: Array<Record<string, unknown>> = [];
    try {
      submissions = (await Promise.race([submissionsPromise, timeoutPromise])) as Array<Record<string, unknown>>;
    } catch (error) {
      const err = error as { code?: string; meta?: { table?: string } };
      if (err.code === 'P2021' && err.meta?.table === 'public.MemeSubmissionTag') {
        const fallback = await prisma.memeSubmission.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
          select: {
            id: true,
            channelId: true,
            submitterUserId: true,
            title: true,
            type: true,
            fileUrlTemp: true,
            sourceUrl: true,
            sourceKind: true,
            memeAssetId: true,
            notes: true,
            status: true,
            moderatorNotes: true,
            revision: true,
            createdAt: true,
            memeAsset: {
              select: { fileUrl: true },
            },
          },
        });
        submissions = fallback.map((s) => ({ ...s, tags: [] }));
      } else {
        throw error;
      }
    }

    if (!Array.isArray(submissions)) {
      return res.json({ items: [], nextCursor: null });
    }

    const hasMore = submissions.length > limit;
    const sliced = hasMore ? submissions.slice(0, limit) : submissions;
    const items = sliced.map((s) => {
      const row = (s || {}) as Record<string, unknown>;
      const rest = { ...row };
      if ('memeAsset' in rest) {
        delete rest.memeAsset;
      }
      const sourceKind = typeof row.sourceKind === 'string' ? row.sourceKind.toLowerCase() : '';
      const sourceUrl = row.sourceUrl ?? null;
      const memeAsset = row.memeAsset as { fileUrl?: string | null } | undefined;
      return {
        ...rest,
        sourceUrl: sourceKind === 'pool' && !sourceUrl ? memeAsset?.fileUrl ?? null : sourceUrl,
      };
    });
    const nextCursor = hasMore ? encodeCursorFromItem(items[items.length - 1], DEFAULT_CURSOR_SCHEMA) : null;
    return res.json({ items, nextCursor });
  } catch (error) {
    const err = error as Error;
    logger.error('submission.get_my_submissions_failed', {
      requestId: req.requestId,
      userId: req.userId,
      channelId: req.channelId,
      errorMessage: err.message,
    });
    if (!res.headersSent) {
      if (err.message?.includes('timeout')) {
        return res.status(408).json({
          errorCode: ERROR_CODES.TIMEOUT,
          error: 'Request timeout',
          message: 'Submissions query timed out. Please try again.',
        });
      }

      return res.status(500).json({
        errorCode: ERROR_CODES.INTERNAL_ERROR,
        error: 'Internal server error',
        message: 'Failed to fetch submissions',
      });
    }
  }
};
