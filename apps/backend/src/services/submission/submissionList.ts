import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import type { MemeSubmission, Prisma } from '@prisma/client';
import { logger } from '../../utils/logger.js';
import {
  DEFAULT_CURSOR_SCHEMA,
  PaginationError,
  buildCursorFilter,
  encodeCursorFromItem,
  mergeCursorWhere,
  parseLimit,
  safeDecodeCursor,
} from '../../utils/pagination.js';
import type { AdminSubmissionDeps } from './submissionTypes.js';
import { asRecord, getErrorMessage } from './submissionShared.js';

type Submission = MemeSubmission;
export const getSubmissionsWithRepos = async (deps: AdminSubmissionDeps, req: AuthRequest, res: Response) => {
  const { submissions: submissionsRepo } = deps;
  const status = req.query.status as string | undefined;
  const aiStatus = req.query.aiStatus as string | undefined;
  const qRaw = req.query.q as string | undefined;
  const q = typeof qRaw === 'string' ? qRaw.trim() : '';
  const channelId = req.channelId;
  const cursorRaw = req.query.cursor;
  const includeTotalRaw = req.query.includeTotal as string | undefined;
  const includeTagsRaw = req.query.includeTags as string | undefined;
  const includeTotal =
    includeTotalRaw !== undefined &&
    (includeTotalRaw === '1' || includeTotalRaw.toLowerCase() === 'true' || includeTotalRaw.toLowerCase() === 'yes');
  const includeTags =
    includeTagsRaw === undefined ||
    includeTagsRaw === '1' ||
    includeTagsRaw.toLowerCase() === 'true' ||
    includeTagsRaw.toLowerCase() === 'yes';

  // Defensive paging (admin endpoints can still be abused).
  const maxFromEnv = parseInt(String(process.env.ADMIN_SUBMISSIONS_PAGE_MAX || ''), 10);
  const envMax = Number.isFinite(maxFromEnv) && maxFromEnv > 0 ? maxFromEnv : 100;
  const MAX_PAGE = Math.min(envMax, 100);
  const defaultLimit = Math.min(50, MAX_PAGE);
  let limit = defaultLimit;
  let cursor = null;
  try {
    limit = parseLimit(req.query.limit, { defaultLimit, maxLimit: MAX_PAGE });
    cursor = safeDecodeCursor(cursorRaw, DEFAULT_CURSOR_SCHEMA);
  } catch (error: unknown) {
    if (error instanceof PaginationError) {
      return res.status(error.status).json({
        errorCode: error.errorCode,
        error: error.message,
        details: error.details,
      });
    }
    throw error;
  }

  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  try {
    const baseWhere = {
      channelId,
      ...(status ? { status } : {}),
      ...(aiStatus ? { aiStatus } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { submitter: { displayName: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const cursorFilter = cursor ? buildCursorFilter(DEFAULT_CURSOR_SCHEMA, cursor) : null;
    const where = mergeCursorWhere(baseWhere, cursorFilter);

    // Perf: tags are not needed for the pending list UI; allow skipping JOINs.
    // Back-compat: default includeTags=true.
    const baseQuery: Record<string, unknown> = {
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    };

    const selectWithTags = {
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
      aiStatus: true,
      aiRetryCount: true,
      aiError: true,
      revision: true,
      createdAt: true,
      submitter: {
        select: { id: true, displayName: true },
      },
      memeAsset: {
        select: { fileUrl: true },
      },
      tags: {
        select: {
          tag: { select: { id: true, name: true } },
        },
      },
    } as const;

    const selectWithoutTags = {
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
      aiStatus: true,
      aiRetryCount: true,
      aiError: true,
      revision: true,
      createdAt: true,
      submitter: {
        select: { id: true, displayName: true },
      },
      memeAsset: {
        select: { fileUrl: true },
      },
    } as const;

    // Add timeout protection (keep conservative: DB can hang under load)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Database query timeout')), 10000); // 10 seconds
    });

    let submissions: Array<Record<string, unknown>> = [];
    if (!includeTags) {
      submissions = (await Promise.race([
        submissionsRepo.findMany({ ...baseQuery, select: selectWithoutTags }),
        timeoutPromise,
      ])) as Array<Record<string, unknown>>;
    } else {
      const submissionsPromise = submissionsRepo.findMany({ ...baseQuery, select: selectWithTags });
      try {
        submissions = (await Promise.race([submissionsPromise, timeoutPromise])) as Array<Record<string, unknown>>;
      } catch (error: unknown) {
        // If error is about MemeSubmissionTag table, retry without tags
        const errorRec = asRecord(error);
        const metaRec = asRecord(errorRec.meta);
        if (errorRec.code === 'P2021' && metaRec.table === 'public.MemeSubmissionTag') {
          logger.warn('admin.submissions.tags_table_missing');
          submissions = (await submissionsRepo.findMany({ ...baseQuery, select: selectWithoutTags })) as Array<
            Record<string, unknown>
          >;
          // Add empty tags array to match expected structure
          submissions = (Array.isArray(submissions) ? submissions : []).map((s) => ({ ...asRecord(s), tags: [] }));
        } else if (getErrorMessage(error) === 'Database query timeout') {
          return res.status(408).json({
            error: 'Request timeout',
            message: 'Database query timed out. Please try again.',
          });
        } else {
          throw error;
        }
      }
    }

    const hasMore = Array.isArray(submissions) && submissions.length > limit;
    const sliced = hasMore ? submissions.slice(0, limit) : submissions;
    const items = Array.isArray(sliced)
      ? sliced.map((s) => {
          const rec = asRecord(s);
          const memeAsset = asRecord(rec.memeAsset);
          const { memeAsset: _memeAsset, ...rest } = rec;
          void _memeAsset;
          return {
            ...rest,
            sourceUrl:
              String(rec.sourceKind || '').toLowerCase() === 'pool' && !rec.sourceUrl
                ? (memeAsset.fileUrl ?? null)
                : (rec.sourceUrl ?? null),
          };
        })
      : [];
    const nextCursor = hasMore ? encodeCursorFromItem(items[items.length - 1], DEFAULT_CURSOR_SCHEMA) : null;
    // Perf: counting can be expensive on large datasets; only compute if requested.
    const total = includeTotal ? await submissionsRepo.count({ where }) : null;
    return res.json({ items, nextCursor, total });
  } catch (error: unknown) {
    logger.error('admin.submissions.fetch_failed', { errorMessage: getErrorMessage(error) });
    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to fetch submissions',
        details: process.env.NODE_ENV === 'development' ? getErrorMessage(error) : undefined,
      });
    }
  }
};
