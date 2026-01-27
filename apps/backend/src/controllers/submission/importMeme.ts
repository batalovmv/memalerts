import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import type { MemeSubmission, Prisma } from '@prisma/client';
import type { z } from 'zod';
import { ZodError } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { importMemeSchema } from '../../shared/schemas.js';
import { getStreamStatusSnapshot } from '../../realtime/streamStatusStore.js';
import { getOrCreateTags } from '../../utils/tags.js';
import { decrementFileHashReference } from '../../utils/fileHash.js';
import { generateTagNames } from '../../utils/ai/tagging.js';
import { makeAutoDescription } from '../../utils/ai/description.js';
import { logger } from '../../utils/logger.js';
import { enqueueAiModerationJob } from '../../queues/aiModerationQueue.js';
import { createOwnerImportMeme } from './importMemeOwner.js';
import { downloadAndPrepareImportFile } from './importMemeDownload.js';
import { getChannelIdFromRequest } from './importMemeHelpers.js';
import { evaluateAndApplySpamBan, getActiveSpamBan } from '../../services/spamBan.js';

type ImportMemeInput = z.infer<typeof importMemeSchema>;

export const importMeme = async (req: AuthRequest, res: Response) => {
  let fileHashForCleanup: string | null = null;
  let fileHashRefAdded = false;
  const channelId = getChannelIdFromRequest(req);
  if (!channelId) {
    return res
      .status(400)
      .json({ errorCode: 'BAD_REQUEST', error: 'Channel ID required', details: { field: 'channelId' } });
  }

  const channel = await prisma.channel.findUnique({
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

  if (!isOwner && req.userId) {
    const banState = await getActiveSpamBan(req.userId);
    if (banState.isBanned) {
      if (banState.retryAfterSeconds) {
        res.setHeader('Retry-After', String(banState.retryAfterSeconds));
      }
      return res.status(429).json({
        errorCode: 'USER_SPAM_BANNED',
        error: 'User is temporarily banned from submissions',
        details: {
          banUntil: banState.banUntil,
          banCount: banState.banCount,
          reason: banState.reason,
        },
      });
    }
  }

  if (!isOwner && !channel.submissionsEnabled) {
    return res.status(403).json({
      error: 'Submissions are disabled for this channel',
      errorCode: 'STREAMER_SUBMISSIONS_DISABLED',
    });
  }

  if (!isOwner && channel.submissionsOnlyWhenLive) {
    const slug = channel.slug.toLowerCase();
    const snap = await getStreamStatusSnapshot(slug);
    if (snap.status !== 'online') {
      return res.status(403).json({
        error: 'Submissions are allowed only while the stream is live',
        errorCode: 'ONLY_WHEN_LIVE',
      });
    }
  }

  try {
    const body = importMemeSchema.parse(req.body) as ImportMemeInput;

    const titleInput = body.title.trim();
    const userProvidedTitle = titleInput.length > 0;
    const finalTitle = userProvidedTitle ? titleInput : 'Мем';

    const isValidUrl = body.sourceUrl.includes('memalerts.com') || body.sourceUrl.includes('cdns.memealerts.com');
    if (!isValidUrl) {
      return res.status(400).json({
        errorCode: 'INVALID_MEDIA_URL',
        error: 'Invalid media URL',
        details: { allowed: ['memalerts.com', 'cdns.memealerts.com'] },
      });
    }

    let finalFilePath: string | null = null;
    let fileHash: string | null = null;
    let detectedDurationMs: number | null = null;
    try {
      const prepared = await downloadAndPrepareImportFile(body.sourceUrl);
      finalFilePath = prepared.finalFilePath;
      fileHash = prepared.fileHash;
      detectedDurationMs = prepared.detectedDurationMs;
      fileHashForCleanup = prepared.fileHashForCleanup;
      fileHashRefAdded = prepared.fileHashRefAdded;
    } catch (dlErr) {
      const err = dlErr as { code?: string; details?: unknown; message?: string };
      if (err.code === 'INVALID_FILE_CONTENT') {
        return res.status(400).json({
          errorCode: 'INVALID_FILE_CONTENT',
          error: 'Invalid file content',
          details: err.details,
        });
      }
      if (err.code === 'FILE_TOO_LARGE') {
        return res.status(413).json({
          errorCode: 'FILE_TOO_LARGE',
          error: 'File too large',
          details: err.details,
        });
      }
      if (err.code === 'VIDEO_TOO_LONG') {
        return res.status(413).json({
          errorCode: 'VIDEO_TOO_LONG',
          error: 'Video is too long',
          details: err.details,
        });
      }
      return res.status(502).json({
        errorCode: 'UPLOAD_FAILED',
        error: 'Upload failed',
        message: err.message || 'Download failed',
      });
    }
    if (!finalFilePath) {
      return res.status(502).json({
        errorCode: 'UPLOAD_FAILED',
        error: 'Upload failed',
        message: 'Download failed',
      });
    }

    if (fileHash) {
      const existingAsset = await prisma.memeAsset.findFirst({
        where: { fileHash },
        select: {
          id: true,
          type: true,
          fileUrl: true,
          fileHash: true,
          durationMs: true,
          status: true,
          deletedAt: true,
          aiAutoDescription: true,
          aiAutoTagNames: true,
          aiSearchText: true,
        },
      });

      if (existingAsset) {
        if (existingAsset.status !== 'active' || existingAsset.deletedAt) {
          if (fileHashRefAdded && fileHash) {
            try {
              await decrementFileHashReference(fileHash);
              fileHashRefAdded = false;
            } catch {
              // ignore
            }
          }
          return res.status(410).json({
            errorCode: 'ASSET_PURGED_OR_QUARANTINED',
            error: 'This meme was deleted and cannot be imported again',
            requestId: req.requestId,
            details: {
              fileHash,
              memeAssetId: existingAsset.id,
              status: existingAsset.status,
              deletedAt: existingAsset.deletedAt,
            },
          });
        }

        const existingCm = await prisma.channelMeme.findUnique({
          where: { channelId_memeAssetId: { channelId: String(channelId), memeAssetId: existingAsset.id } },
          select: { id: true, deletedAt: true, memeAssetId: true },
        });

        if (existingCm && !existingCm.deletedAt) {
          if (fileHashRefAdded && fileHash) {
            try {
              await decrementFileHashReference(fileHash);
              fileHashRefAdded = false;
            } catch {
              // ignore
            }
          }
          return res.status(409).json({
            errorCode: 'ALREADY_IN_CHANNEL',
            error: 'This meme is already in your channel',
            requestId: req.requestId,
          });
        }

        if (isOwner && existingCm && existingCm.deletedAt) {
          if (fileHashRefAdded && fileHash) {
            try {
              await decrementFileHashReference(fileHash);
              fileHashRefAdded = false;
            } catch {
              // ignore
            }
          }

          const defaultPrice = channel.defaultPriceCoins ?? 100;

          const restored = await prisma.$transaction(async (tx) => {
            const restored = await tx.channelMeme.update({
              where: { id: existingCm.id },
              data: {
                status: 'approved',
                deletedAt: null,
                title: finalTitle,
                priceCoins: defaultPrice,
              },
              select: { id: true, memeAssetId: true },
            });

            if (userProvidedTitle) {
              const fallbackDesc = makeAutoDescription({ title: finalTitle, transcript: null, labels: [] });
              const fallbackTags = generateTagNames({ title: finalTitle, transcript: null, labels: [] }).tagNames;
              const fallbackSearchText = [finalTitle, fallbackTags.join(' '), fallbackDesc || '']
                .map((s) => String(s || '').trim())
                .filter(Boolean)
                .join('\n')
                .slice(0, 4000);

              const hasAiDesc = !!existingAsset.aiAutoDescription;
              const hasAiTags =
                Array.isArray(existingAsset.aiAutoTagNames) && existingAsset.aiAutoTagNames.length > 0;
              const updateData: Prisma.MemeAssetUpdateInput = {};
              if (!hasAiDesc && fallbackDesc) updateData.aiAutoDescription = String(fallbackDesc).slice(0, 2000);
              if (!hasAiTags && fallbackTags.length > 0) updateData.aiAutoTagNames = fallbackTags;
              if (!existingAsset.aiSearchText && fallbackSearchText) updateData.aiSearchText = fallbackSearchText;

              if (Object.keys(updateData).length > 0) {
                await tx.memeAsset.update({ where: { id: existingAsset.id }, data: updateData });
              }
            }

            return restored;
          });

          try {
            if (existingAsset.fileUrl) {
              const existingDuration =
                typeof existingAsset.durationMs === 'number' &&
                Number.isFinite(existingAsset.durationMs) &&
                existingAsset.durationMs > 0
                  ? existingAsset.durationMs
                  : null;
              const ownerRestoreSubmissionData: Prisma.MemeSubmissionUncheckedCreateInput = {
                channelId: String(channelId),
                submitterUserId: req.userId!,
                title: finalTitle,
                type: existingAsset.type,
                fileUrlTemp: existingAsset.fileUrl,
                sourceKind: 'upload',
                status: 'approved',
                memeAssetId: existingAsset.id,
                fileHash: existingAsset.fileHash ?? null,
                durationMs: existingDuration,
                aiStatus: 'pending',
              };
              const submission = await prisma.memeSubmission.create({
                data: ownerRestoreSubmissionData,
              });
              logger.info('ai.enqueue', { submissionId: submission.id, reason: 'owner_restore' });
              void enqueueAiModerationJob(submission.id, { reason: 'owner_restore' });
            }
          } catch (error) {
            logger.warn('submission.ai.enqueue_failed', {
              requestId: req.requestId ?? null,
              userId: req.userId ?? null,
              channelId: String(channelId),
              reason: 'memeSubmission_create_failed',
              errorMessage: error instanceof Error ? error.message : String(error),
            });
          }

          return res.status(201).json({
            isDirectApproval: true,
            channelMemeId: restored.id,
            memeAssetId: restored.memeAssetId,
            sourceKind: 'url',
            isRestored: true,
            status: 'approved',
            deletedAt: null,
          });
        }
      }
    }

    let tagIds: string[] = [];
    try {
      const tagsPromise = getOrCreateTags(body.tags || []);
      const tagsTimeout = new Promise<string[]>((resolve) => {
        setTimeout(() => {
          logger.warn('submission.import.tags_timeout');
          resolve([]);
        }, 5000);
      });
      tagIds = await Promise.race([tagsPromise, tagsTimeout]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('submission.import.tags_create_failed', { errorMessage });
      tagIds = [];
    }

    if (isOwner) {
      return await createOwnerImportMeme({
        req,
        res,
        channelId,
        channel,
        finalTitle,
        tagIds,
        finalFilePath,
        fileHash,
        detectedDurationMs,
        userProvidedTitle,
      });
    }

    const submissionData: Prisma.MemeSubmissionUncheckedCreateInput = {
      channelId,
      submitterUserId: req.userId!,
      title: finalTitle,
      type: 'video',
      fileUrlTemp: finalFilePath,
      sourceUrl: body.sourceUrl,
      sourceKind: 'url',
      notes: body.notes || null,
      status: 'pending',
    };

    if (tagIds.length > 0) {
      submissionData.tags = {
        create: tagIds.map((tagId) => ({
          tagId,
        })),
      };
    }

    const submissionPromise = prisma.memeSubmission.create({
      data: submissionData,
      include:
        tagIds.length > 0
          ? {
              tags: {
                include: {
                  tag: true,
                },
              },
            }
          : undefined,
    });

    const submissionTimeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Submission creation timeout')), 10000);
    });

    let submission: MemeSubmission | null = null;
    try {
      submission = await Promise.race([submissionPromise, submissionTimeout]);
    } catch (dbError) {
      const dbErrorCode = typeof dbError === 'object' && dbError !== null ? (dbError as { code?: string }).code : null;
      const dbErrorMeta =
        typeof dbError === 'object' && dbError !== null ? (dbError as { meta?: { table?: string } }).meta : null;
      if (dbErrorCode === 'P2021' && dbErrorMeta?.table === 'public.MemeSubmissionTag') {
        logger.warn('submission.import.tags_table_missing');
        submission = await prisma.memeSubmission.create({
          data: {
            channelId,
            submitterUserId: req.userId!,
            title: finalTitle,
            type: 'video',
            fileUrlTemp: finalFilePath ?? body.sourceUrl,
            sourceUrl: body.sourceUrl,
            sourceKind: 'url',
            notes: body.notes || null,
            status: 'pending',
          },
        });
      } else if ((dbError as Error)?.message === 'Submission creation timeout') {
        return res.status(408).json({
          error: 'Request timeout',
          message: 'Submission creation timed out. Please try again.',
        });
      } else {
        throw dbError;
      }
    }

    if (!submission) {
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Submission creation failed',
      });
    }

    logger.info('ai.enqueue', { submissionId: submission.id, reason: 'import_submission' });
    void enqueueAiModerationJob(submission.id, { reason: 'import_submission' });

    if (req.userId && !isOwner) {
      void evaluateAndApplySpamBan(req.userId);
    }

    return res.status(201).json(submission);
  } catch (error) {
    const isZodError = error instanceof ZodError;
    if (fileHashRefAdded && fileHashForCleanup) {
      try {
        await decrementFileHashReference(fileHashForCleanup);
        fileHashRefAdded = false;
      } catch {
        // ignore
      }
    }
    if (isZodError) {
      return res.status(400).json({
        errorCode: 'BAD_REQUEST',
        error: 'Validation error',
        details: (error as ZodError).errors,
      });
    }
    throw error;
  }
};
