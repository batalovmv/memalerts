import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import type { Meme, Prisma } from '@prisma/client';
import type { SubmissionDeps } from './submissionTypes.js';
import { enqueueAiModerationJob } from '../../queues/aiModerationQueue.js';
import { logger } from '../../utils/logger.js';
import { logFileUpload } from '../../utils/auditLogger.js';
import { makeAutoDescription } from '../../utils/ai/description.js';
import { generateTagNames } from '../../utils/ai/tagging.js';

export async function handleOwnerDirectSubmission(opts: {
  deps: SubmissionDeps;
  req: AuthRequest;
  res: Response;
  channelId: string;
  defaultPriceCoins: number | null;
  finalTitle: string;
  userProvidedTitle: boolean;
  tagIds: string[];
  finalFilePath: string;
  fileHash: string | null;
  normalizedMimeType: string;
  normalizedSizeBytes: number;
  effectiveDurationMs: number | null;
}): Promise<boolean> {
  const {
    deps,
    req,
    res,
    channelId,
    defaultPriceCoins,
    finalTitle,
    userProvidedTitle,
    tagIds,
    finalFilePath,
    fileHash,
    normalizedMimeType,
    normalizedSizeBytes,
    effectiveDurationMs,
  } = opts;
  const { memes, transaction, submissions } = deps;

  logger.info('submission.owner_direct_approval', {
    requestId: req.requestId,
    userId: req.userId,
    channelId,
  });

  const durationMs = Math.max(0, Math.min(effectiveDurationMs ?? 0, 15000));
  const defaultPrice = defaultPriceCoins ?? 100;

  const memeDataBase: Prisma.MemeUncheckedCreateInput = {
    channelId,
    title: finalTitle,
    type: 'video',
    fileUrl: finalFilePath,
    durationMs,
    priceCoins: defaultPrice,
    status: 'approved',
    createdByUserId: req.userId!,
    approvedByUserId: req.userId!,
    fileHash,
  };

  const runOwnerCreateTx = async (useTags: boolean) =>
    transaction(async (txRepos) => {
      const meme = await txRepos.memes.meme.create({
        data: {
          ...memeDataBase,
          ...(useTags && tagIds.length > 0
            ? {
                tags: {
                  create: tagIds.map((tagId) => ({
                    tagId,
                  })),
                },
              }
            : {}),
        },
        include:
          useTags && tagIds.length > 0
            ? {
                tags: {
                  include: {
                    tag: true,
                  },
                },
              }
            : undefined,
      });

      const existingAsset = fileHash
        ? await txRepos.memes.asset.findFirst({ where: { fileHash }, select: { id: true } })
        : await txRepos.memes.asset.findFirst({
            where: { fileHash: null, fileUrl: finalFilePath, type: 'video', durationMs },
            select: { id: true },
          });

      const memeAssetId =
        existingAsset?.id ??
        (
          await txRepos.memes.asset.create({
            data: {
              type: 'video',
              fileUrl: finalFilePath,
              fileHash,
              durationMs,
              createdByUserId: req.userId!,
            },
            select: { id: true },
          })
        ).id;

      const cm = await txRepos.memes.channelMeme.upsert({
        where: { channelId_memeAssetId: { channelId: String(channelId), memeAssetId } },
        create: {
          channelId: String(channelId),
          memeAssetId,
          legacyMemeId: meme?.id || null,
          status: 'approved',
          title: finalTitle,
          priceCoins: defaultPrice,
          addedByUserId: req.userId!,
          approvedByUserId: req.userId!,
          approvedAt: new Date(),
        },
        update: {
          legacyMemeId: meme?.id || null,
          status: 'approved',
          title: finalTitle,
          priceCoins: defaultPrice,
          approvedByUserId: req.userId!,
          approvedAt: new Date(),
          deletedAt: null,
        },
        select: { id: true },
      });

      return { meme, memeAssetId, channelMemeId: cm.id };
    });

  let meme: Meme | null = null;
  let memeAssetId: string | null = null;
  let channelMemeId: string | null = null;
  try {
    const resTx = await runOwnerCreateTx(tagIds.length > 0);
    meme = resTx.meme;
    memeAssetId = resTx.memeAssetId;
    channelMemeId = resTx.channelMemeId;
  } catch (error) {
    const errorCode = typeof error === 'object' && error !== null ? (error as { code?: string }).code : null;
    const errorMeta =
      typeof error === 'object' && error !== null ? (error as { meta?: { table?: string } }).meta : null;
    if (errorCode === 'P2021' && errorMeta?.table === 'public.MemeTag' && tagIds.length > 0) {
      logger.warn('submission.owner.meme_tag_table_missing', {
        requestId: req.requestId,
        userId: req.userId,
        channelId,
        errorCode,
        table: errorMeta?.table,
      });
      const resTx = await runOwnerCreateTx(false);
      meme = resTx.meme;
      memeAssetId = resTx.memeAssetId;
      channelMemeId = resTx.channelMemeId;
    } else if (errorCode === 'P2002') {
      res.status(409).json({
        errorCode: 'ALREADY_IN_CHANNEL',
        error: 'This meme is already in your channel',
        requestId: req.requestId,
      });
      return true;
    } else {
      throw error;
    }
  }

  const fallbackDesc = userProvidedTitle
    ? makeAutoDescription({ title: finalTitle, transcript: null, labels: [] })
    : null;
  const fallbackTags = userProvidedTitle
    ? generateTagNames({ title: finalTitle, transcript: null, labels: [] }).tagNames
    : [];
  const fallbackSearchText = fallbackDesc ? String(fallbackDesc).slice(0, 4000) : null;

  try {
    const fallbackUpdate: Prisma.ChannelMemeUpdateArgs['data'] = {
      aiAutoDescription: fallbackDesc ? String(fallbackDesc).slice(0, 2000) : null,
      aiAutoTagNamesJson: fallbackTags,
      searchText: fallbackSearchText,
    };
    await memes.channelMeme.updateMany({
      where: { id: channelMemeId! },
      data: fallbackUpdate,
    });
  } catch {
    // ignore
  }

  try {
    const ownerSubmissionData: Prisma.MemeSubmissionUncheckedCreateInput = {
      channelId: String(channelId),
      submitterUserId: req.userId!,
      title: finalTitle,
      type: 'video',
      fileUrlTemp: finalFilePath,
      sourceKind: 'upload',
      status: 'approved',
      memeAssetId,
      fileHash,
      durationMs: durationMs > 0 ? durationMs : null,
      mimeType: normalizedMimeType || req.file?.mimetype || null,
      fileSizeBytes: Number.isFinite(normalizedSizeBytes) ? normalizedSizeBytes : null,
      aiStatus: 'pending',
    };
    const submission = await submissions.create({
      data: ownerSubmissionData,
    });
    logger.info('ai.enqueue', { submissionId: submission.id, reason: 'owner_direct' });
    void enqueueAiModerationJob(submission.id, { reason: 'owner_direct' });
  } catch (error) {
    logger.warn('submission.ai.enqueue_failed', {
      requestId: req.requestId ?? null,
      userId: req.userId ?? null,
      channelId: String(channelId),
      reason: 'memeSubmission_create_failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  await logFileUpload(req.userId!, channelId as string, finalFilePath, normalizedSizeBytes, true, req);

  res.status(201).json({
    ...meme,
    isDirectApproval: true,
    isRestored: false,
    channelMemeId,
    memeAssetId,
    status: 'approved',
    deletedAt: null,
  });
  return true;
}
