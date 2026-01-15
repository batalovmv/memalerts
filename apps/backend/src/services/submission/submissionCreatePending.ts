import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import type { Server } from 'socket.io';
import type { MemeSubmission, Prisma } from '@prisma/client';
import type { SubmissionDeps } from './submissionTypes.js';
import { enqueueAiModerationJob } from '../../queues/aiModerationQueue.js';
import { emitSubmissionEvent, relaySubmissionEventToPeer } from '../../realtime/submissionBridge.js';
import { logger } from '../../utils/logger.js';
import { debugLog } from '../../utils/debug.js';
import { logFileUpload } from '../../utils/auditLogger.js';
import { decrementFileHashReference } from '../../utils/fileHash.js';
import { safeUnlink } from './submissionShared.js';

export async function handlePendingSubmission(opts: {
  deps: SubmissionDeps;
  req: AuthRequest;
  res: Response;
  channelId: string;
  submissionIdempotencyKey: string | null;
  finalTitle: string;
  bodyNotes: string | null;
  finalFilePath: string;
  fileHash: string | null;
  effectiveDurationMs: number | null;
  normalizedMimeType: string;
  normalizedSizeBytes: number;
  tagIds: string[];
  tempFileForCleanup: string | null;
  fileHashForCleanup: string | null;
  fileHashRefAdded: boolean;
}): Promise<boolean> {
  const {
    deps,
    req,
    res,
    channelId,
    submissionIdempotencyKey,
    finalTitle,
    bodyNotes,
    finalFilePath,
    fileHash,
    effectiveDurationMs,
    normalizedMimeType,
    normalizedSizeBytes,
    tagIds,
    tempFileForCleanup,
    fileHashForCleanup,
    fileHashRefAdded,
  } = opts;
  const { submissions, memes, channels } = deps;

  const submissionDataBase: Prisma.MemeSubmissionUncheckedCreateInput = {
    channelId,
    submitterUserId: req.userId!,
    title: finalTitle,
    type: 'video',
    fileUrlTemp: finalFilePath,
    notes: bodyNotes || null,
    status: 'pending',
    sourceKind: 'upload',
    idempotencyKey: submissionIdempotencyKey,
    fileHash,
    durationMs: effectiveDurationMs !== null ? Math.max(0, Math.min(effectiveDurationMs, 15000)) : null,
    mimeType: normalizedMimeType || req.file?.mimetype || null,
    fileSizeBytes: Number.isFinite(normalizedSizeBytes) ? normalizedSizeBytes : null,
  };

  try {
    if (fileHash) {
      const aiAsset = await memes.asset.findFirst({
        where: { fileHash, aiStatus: 'done' },
        select: { aiAutoDescription: true, aiAutoTagNamesJson: true },
      });
      const normalizeAiText = (s: string) =>
        String(s || '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .replace(/[????"]/g, '')
          .trim();
      const extractTitleTokens = (titleRaw: unknown): string[] => {
        const title = normalizeAiText(String(titleRaw ?? ''));
        if (!title) return [];
        const cleaned = title.replace(/[^a-z0-9?-??]+/gi, ' ');
        const tokens = cleaned
          .split(' ')
          .map((t) => t.trim())
          .filter(Boolean)
          .filter((t) => t.length >= 2);
        return Array.from(new Set(tokens));
      };
      const isEffectivelyEmptyAiDescription = (descRaw: unknown, titleRaw: unknown): boolean => {
        const desc = normalizeAiText(String(descRaw ?? ''));
        if (!desc) return true;
        const title = normalizeAiText(String(titleRaw ?? ''));
        if (title && desc === title) return true;
        const placeholders = new Set([
          '???',
          'meme',
          'ai tags',
          'ai tag',
          'tags',
          '????',
          '????????',
          'description',
          'ai description',
        ]);
        if (placeholders.has(desc)) return true;
        if (desc === '??? ai tags ???' || desc === 'meme ai tags meme') return true;
        return false;
      };

      const hasReusableDescription = !isEffectivelyEmptyAiDescription(aiAsset?.aiAutoDescription, finalTitle);
      const hasReusableTags = (() => {
        const arr = aiAsset && Array.isArray(aiAsset.aiAutoTagNamesJson) ? aiAsset.aiAutoTagNamesJson : [];
        if (arr.length === 0) return false;
        const placeholders = new Set(['???', 'meme', '????', 'test', 'ai tags', 'ai tag', 'tags', '????']);
        const nonPlaceholder = arr
          .map((t) => normalizeAiText(String(t ?? '')))
          .filter(Boolean)
          .filter((t) => !placeholders.has(t));
        if (nonPlaceholder.length === 0) return false;

        if (isEffectivelyEmptyAiDescription(aiAsset?.aiAutoDescription, finalTitle)) {
          const titleTokens = new Set(extractTitleTokens(finalTitle));
          if (titleTokens.size > 0) {
            const allFromTitle = nonPlaceholder.every((t) => titleTokens.has(t));
            if (allFromTitle) return false;
          }
        }

        return nonPlaceholder.length > 0;
      })();

      if (aiAsset && (hasReusableDescription || hasReusableTags)) {
        submissionDataBase.aiStatus = 'done';
        submissionDataBase.aiAutoDescription = aiAsset.aiAutoDescription ?? null;
        submissionDataBase.aiAutoTagNamesJson = Array.isArray(aiAsset.aiAutoTagNamesJson)
          ? aiAsset.aiAutoTagNamesJson
          : undefined;
        const now = new Date();
        submissionDataBase.aiLastTriedAt = now;
        submissionDataBase.aiCompletedAt = now;
        submissionDataBase.aiNextRetryAt = null;
        submissionDataBase.aiError = null;
        submissionDataBase.aiRetryCount = 0;
        submissionDataBase.aiModelVersionsJson = { pipelineVersion: 'v3-reuse-memeasset' };
      }
    }
  } catch {
    // ignore
  }

  const submissionDataWithTags: Prisma.MemeSubmissionUncheckedCreateInput =
    tagIds.length > 0
      ? {
          ...submissionDataBase,
          tags: {
            create: tagIds.map((tagId) => ({ tagId })),
          },
        }
      : submissionDataBase;

  const idempotencyWriteStartedAt = submissionIdempotencyKey ? new Date() : null;
  const buildSubmissionPromise = (useTags: boolean) => {
    const include =
      useTags && tagIds.length > 0
        ? {
            tags: {
              include: {
                tag: true,
              },
            },
          }
        : undefined;
    const data = useTags && tagIds.length > 0 ? submissionDataWithTags : submissionDataBase;

    if (submissionIdempotencyKey) {
      return submissions.upsert({
        where: {
          channelId_submitterUserId_idempotencyKey: {
            channelId,
            submitterUserId: req.userId!,
            idempotencyKey: submissionIdempotencyKey,
          },
        },
        create: data,
        update: {},
        include,
      });
    }

    return submissions.create({ data, include });
  };

  const runSubmissionWrite = async (useTags: boolean) => {
    const submissionPromise = buildSubmissionPromise(useTags);
    const submissionTimeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Submission creation timeout')), 10000);
    });
    return (await Promise.race([submissionPromise, submissionTimeout])) as MemeSubmission;
  };

  let submission: MemeSubmission | null = null;
  try {
    submission = await runSubmissionWrite(tagIds.length > 0);
  } catch (dbError) {
    const dbErrorCode =
      typeof dbError === 'object' && dbError !== null ? (dbError as { code?: string }).code : null;
    const dbErrorMeta =
      typeof dbError === 'object' && dbError !== null ? (dbError as { meta?: { table?: string } }).meta : null;
    if (dbErrorCode === 'P2021' && dbErrorMeta?.table === 'public.MemeSubmissionTag') {
      logger.warn('submission.tags.table_missing', {
        requestId: req.requestId,
        userId: req.userId,
        channelId,
        table: (dbError as { meta?: { table?: string } })?.meta?.table,
      });
      submission = await runSubmissionWrite(false);
    } else {
      throw dbError;
    }
  }

  const idempotencyHit =
    !!submissionIdempotencyKey &&
    !!idempotencyWriteStartedAt &&
    submission.createdAt < idempotencyWriteStartedAt;
  if (idempotencyHit) {
    if (fileHashRefAdded && fileHashForCleanup) {
      try {
        await decrementFileHashReference(fileHashForCleanup);
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

    logger.info('submission.idempotency_hit', {
      requestId: req.requestId,
      userId: req.userId,
      channelId,
      submissionId: submission.id,
    });
    res.status(200).json(submission);
    return true;
  }

  logger.info('ai.enqueue', { submissionId: submission.id, reason: 'create_submission' });
  void enqueueAiModerationJob(submission.id, { reason: 'create_submission' });

  await logFileUpload(req.userId!, channelId as string, finalFilePath, normalizedSizeBytes, true, req);

  debugLog('[DEBUG] Submission created successfully, sending response', { submissionId: submission.id, channelId });

  try {
    const io: Server = req.app.get('io');
    const channel = await channels.findUnique({
      where: { id: channelId as string },
      select: { slug: true, users: { where: { role: 'streamer' }, take: 1, select: { id: true } } },
    });
    const channelRec = channel as { slug?: string | null; users?: Array<{ id?: string | null }> } | null;
    if (channelRec) {
      const channelSlug = String(channelRec.slug || '').toLowerCase();
      const streamerUserId = channelRec.users?.[0]?.id ?? null;
      const evt = {
        event: 'submission:created' as const,
        submissionId: submission.id,
        channelId: channelId as string,
        channelSlug,
        submitterId: req.userId || undefined,
        userIds: streamerUserId ? [streamerUserId] : undefined,
        source: 'local' as const,
      };
      emitSubmissionEvent(io, evt);
      void relaySubmissionEventToPeer(evt);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('submission.emit_event_failed', {
      requestId: req.requestId,
      channelId,
      userId: req.userId,
      errorMessage,
    });
  }

  res.status(201).json(submission);
  return true;
}
