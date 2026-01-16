import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import type { z } from 'zod';
import { ZodError } from 'zod';
import { createSubmissionSchema } from '../../shared/schemas.js';
import { ApiError } from '../../shared/apiError.js';
import type { SubmissionDeps } from './submissionTypes.js';
import { getStreamDurationSnapshot } from '../../realtime/streamDurationStore.js';
import { logger } from '../../utils/logger.js';
import { debugLog } from '../../utils/debug.js';
import { decrementFileHashReference } from '../../utils/fileHash.js';
import { getChannelIdFromRequest, resolveUploadFilePath, safeUnlink } from './submissionShared.js';
import { processSubmissionUpload } from './submissionCreateUpload.js';
import { handleExistingAssetForUpload } from './submissionCreateExistingAsset.js';
import { resolveSubmissionTagIds } from './submissionCreateTags.js';
import { handleOwnerDirectSubmission } from './submissionCreateOwnerDirect.js';
import { handlePendingSubmission } from './submissionCreatePending.js';

type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;

export const createSubmissionWithRepos = async (deps: SubmissionDeps, req: AuthRequest, res: Response) => {
  const { channels, submissions } = deps;
  debugLog('[DEBUG] createSubmission started', { hasFile: !!req.file, userId: req.userId, channelId: req.channelId });
  const rawIdempotencyKey = typeof req.idempotencyKey === 'string' ? req.idempotencyKey.trim() : null;

  if (!req.file) {
    return res.status(400).json({ errorCode: 'BAD_REQUEST', error: 'Bad request', details: { field: 'file' } });
  }

  const channelId = getChannelIdFromRequest(req);
  if (!channelId) {
    return res
      .status(400)
      .json({ errorCode: 'BAD_REQUEST', error: 'Channel ID required', details: { field: 'channelId' } });
  }

  const channel = await channels.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      slug: true,
      defaultPriceCoins: true,
      submissionsEnabled: true,
      submissionsOnlyWhenLive: true,
    },
  });

  if (!channel) {
    return res.status(404).json({ errorCode: 'CHANNEL_NOT_FOUND', error: 'Channel not found', details: { channelId } });
  }

  const isOwner =
    !!req.userId &&
    !!req.channelId &&
    (req.userRole === 'streamer' || req.userRole === 'admin') &&
    String(req.channelId) === String(channelId);

  const submissionIdempotencyKey = !isOwner && rawIdempotencyKey ? rawIdempotencyKey : null;
  if (submissionIdempotencyKey && req.userId) {
    const idempotencyWindowStart = new Date(Date.now() - 60 * 60 * 1000);
    const lookupWhere = {
      channelId_submitterUserId_idempotencyKey: {
        channelId: String(channelId),
        submitterUserId: req.userId,
        idempotencyKey: submissionIdempotencyKey,
      },
    };

    let existing: Awaited<ReturnType<typeof submissions.findUnique>> | null = null;
    try {
      existing = await submissions.findUnique({
        where: lookupWhere,
        include: { tags: { include: { tag: true } } },
      });
    } catch (error) {
      const errorCode = typeof error === 'object' && error !== null ? (error as { code?: string }).code : null;
      const errorMeta =
        typeof error === 'object' && error !== null ? (error as { meta?: { table?: string } }).meta : null;
      if (errorCode === 'P2021' && errorMeta?.table === 'public.MemeSubmissionTag') {
        existing = await submissions.findUnique({ where: lookupWhere });
      } else {
        throw error;
      }
    }

    if (existing) {
      if (existing.createdAt >= idempotencyWindowStart) {
        const filePath = resolveUploadFilePath(req.file.path);
        await safeUnlink(filePath);
        logger.info('submission.idempotency_hit', {
          requestId: req.requestId,
          userId: req.userId,
          channelId,
          submissionId: existing.id,
        });
        return res.status(200).json(existing);
      }
      try {
        await submissions.update({
          where: { id: existing.id },
          data: { idempotencyKey: null },
        });
      } catch {
        // ignore
      }
    }
  }

  const validationError = (req as AuthRequest & { fileValidationError?: ApiError }).fileValidationError;
  if (validationError) {
    const filePath = resolveUploadFilePath(req.file.path);
    await safeUnlink(filePath);
    return res.status(validationError.status).json({
      errorCode: validationError.errorCode,
      error: validationError.message,
      ...(validationError.details !== undefined ? { details: validationError.details } : {}),
    });
  }

  if (!channel.submissionsEnabled) {
    return res.status(403).json({
      error: 'Submissions are disabled for this channel',
      errorCode: 'STREAMER_SUBMISSIONS_DISABLED',
    });
  }

  if (channel.submissionsOnlyWhenLive) {
    const slug = channel.slug.toLowerCase();
    const snap = await getStreamDurationSnapshot(slug);
    if (snap.status !== 'online') {
      return res.status(403).json({
        error: 'Submissions are allowed only while the stream is live',
        errorCode: 'ONLY_WHEN_LIVE',
      });
    }
  }

  const bodyData: Record<string, unknown> = { ...req.body };
  if (typeof bodyData.tags === 'string') {
    try {
      bodyData.tags = JSON.parse(bodyData.tags);
    } catch {
      bodyData.tags = [];
    }
  }

  const body = createSubmissionSchema.parse(bodyData) as CreateSubmissionInput;
  const titleInput = body.title.trim();
  const userProvidedTitle = titleInput.length > 0;
  const finalTitle = userProvidedTitle ? titleInput : '???';

  if (body.type !== 'video') {
    return res.status(400).json({
      errorCode: 'BAD_REQUEST',
      error: 'Only video type is allowed',
      details: { field: 'type', expected: 'video' },
    });
  }

  let tempFileForCleanup: string | null = null;
  let fileHashForCleanup: string | null = null;
  let fileHashRefAdded = false;
  try {
    const uploadResult = await processSubmissionUpload({ req, res, channelId });
    if (!uploadResult) return;

    tempFileForCleanup = uploadResult.tempFileForCleanup;
    fileHashForCleanup = uploadResult.fileHashForCleanup;
    fileHashRefAdded = uploadResult.fileHashRefAdded;

    const { finalFilePath, fileHash, normalizedMimeType, normalizedSizeBytes, effectiveDurationMs } = uploadResult;

    const existingResult = await handleExistingAssetForUpload({
      deps,
      req,
      res,
      channelId,
      isOwner,
      finalTitle,
      userProvidedTitle,
      fileHash,
      fileHashRefAdded,
    });
    fileHashRefAdded = existingResult.fileHashRefAdded;
    if (existingResult.handled) return;

    const tagIds = await resolveSubmissionTagIds({ req, channelId, tags: body.tags || [] });

    if (isOwner) {
      const ownerHandled = await handleOwnerDirectSubmission({
        deps,
        req,
        res,
        channelId,
        defaultPriceCoins: channel.defaultPriceCoins,
        finalTitle,
        userProvidedTitle,
        tagIds,
        finalFilePath,
        fileHash,
        normalizedMimeType,
        normalizedSizeBytes,
        effectiveDurationMs,
      });
      if (ownerHandled) return;
    }

    await handlePendingSubmission({
      deps,
      req,
      res,
      channelId,
      submissionIdempotencyKey,
      finalTitle,
      bodyNotes: body.notes || null,
      finalFilePath,
      fileHash,
      effectiveDurationMs,
      normalizedMimeType,
      normalizedSizeBytes,
      tagIds,
      tempFileForCleanup,
      fileHashForCleanup,
      fileHashRefAdded,
    });
  } catch (error) {
    const isZodError = error instanceof ZodError;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;
    const errorStack = error instanceof Error ? error.stack : undefined;
    const errorName = error instanceof Error ? error.name : undefined;
    logger.error('submission.create_failed', {
      requestId: req.requestId,
      message: errorMessage,
      name: errorName,
      code: errorCode,
      stack: process.env.NODE_ENV === 'production' ? undefined : errorStack,
      hasFile: !!req.file,
      fileSize: req.file?.size,
      channelId: req.channelId,
      userId: req.userId,
    });

    if (fileHashRefAdded && fileHashForCleanup) {
      try {
        await decrementFileHashReference(fileHashForCleanup);
        fileHashRefAdded = false;
      } catch {
        // ignore
      }
    }

    if (tempFileForCleanup) {
      try {
        await safeUnlink(tempFileForCleanup);
        logger.info('submission.upload_cleanup', {
          requestId: req.requestId,
          filePath: tempFileForCleanup,
          userId: req.userId,
          channelId,
        });
      } catch (cleanupError) {
        const cleanupErrorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        logger.error('submission.upload_cleanup_failed', {
          requestId: req.requestId,
          filePath: tempFileForCleanup,
          errorMessage: cleanupErrorMessage,
          userId: req.userId,
          channelId,
        });
      }
    }

    if (isZodError) {
      return res.status(400).json({
        errorCode: 'BAD_REQUEST',
        error: 'Validation error',
        details: (error as ZodError).errors,
      });
    }

    if ((error as Error)?.message === 'Submission creation timeout') {
      return res.status(408).json({
        error: 'Request timeout',
        message: 'Submission creation timed out. Please try again.',
      });
    }

    if (
      (error as { code?: string; name?: string })?.code === 'P2021' ||
      (error as Error)?.name === 'PrismaClientKnownRequestError'
    ) {
      logger.error('submission.db_missing_table', {
        requestId: req.requestId,
        errorMeta: (error as { meta?: unknown })?.meta,
        userId: req.userId,
        channelId,
      });
      if (!res.headersSent) {
        return res.status(500).json({
          error: 'Database error',
          message: 'A database error occurred. Please contact support if this persists.',
          details: process.env.NODE_ENV === 'development' ? (error as Error)?.message : undefined,
        });
      }
      return;
    }

    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Internal server error',
        message: (error as Error)?.message || 'An unexpected error occurred',
        details: process.env.NODE_ENV === 'development' ? (error as Error)?.stack : undefined,
      });
    } else {
      logger.error('submission.response_already_sent', {
        requestId: req.requestId,
        userId: req.userId,
        channelId,
      });
    }
  }
};
