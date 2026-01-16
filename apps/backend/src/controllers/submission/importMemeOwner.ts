import type { Meme, Prisma } from '@prisma/client';
import type { AuthRequest } from '../../middleware/auth.js';
import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { makeAutoDescription } from '../../utils/ai/description.js';
import { generateTagNames } from '../../utils/ai/tagging.js';
import { enqueueAiModerationJob } from '../../queues/aiModerationQueue.js';
import { logger } from '../../utils/logger.js';

export async function createOwnerImportMeme(params: {
  req: AuthRequest;
  res: Response;
  channelId: string;
  channel: { defaultPriceCoins: number | null };
  finalTitle: string;
  tagIds: string[];
  finalFilePath: string;
  fileHash: string | null;
  detectedDurationMs: number | null;
  userProvidedTitle: boolean;
}): Promise<Response> {
  const {
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
  } = params;

  const defaultPrice = channel.defaultPriceCoins ?? 100;
  const durationMsSafe = Math.max(0, Math.min(detectedDurationMs ?? 0, 15000));

  const memeCreateBase: Prisma.MemeUncheckedCreateInput = {
    channelId,
    title: finalTitle,
    type: 'video',
    fileUrl: finalFilePath,
    fileHash,
    durationMs: durationMsSafe,
    priceCoins: defaultPrice,
    status: 'approved',
    createdByUserId: req.userId!,
    approvedByUserId: req.userId!,
  };

  const runOwnerCreateTx = async (useTags: boolean) =>
    prisma.$transaction(async (tx) => {
      const meme = await tx.meme.create({
        data: {
          ...memeCreateBase,
          ...(useTags && tagIds.length > 0
            ? {
                tags: {
                  create: tagIds.map((tagId) => ({ tagId })),
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
        ? await tx.memeAsset.findFirst({ where: { fileHash }, select: { id: true } })
        : await tx.memeAsset.findFirst({
            where: { fileHash: null, fileUrl: finalFilePath, type: 'video', durationMs: durationMsSafe },
            select: { id: true },
          });

      const memeAssetId =
        existingAsset?.id ??
        (
          await tx.memeAsset.create({
            data: {
              type: 'video',
              fileUrl: finalFilePath,
              fileHash,
              durationMs: durationMsSafe,
              createdByUserId: req.userId!,
            },
            select: { id: true },
          })
        ).id;

      const cm = await tx.channelMeme.upsert({
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
      const resTx = await runOwnerCreateTx(false);
      meme = resTx.meme;
      memeAssetId = resTx.memeAssetId;
      channelMemeId = resTx.channelMemeId;
    } else if (errorCode === 'P2002') {
      return res.status(409).json({
        errorCode: 'ALREADY_IN_CHANNEL',
        error: 'This meme is already in your channel',
        requestId: req.requestId,
      });
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
    await prisma.channelMeme.updateMany({
      where: { id: channelMemeId! },
      data: fallbackUpdate,
    });
  } catch {
    // ignore
  }

  try {
    const ownerImportSubmissionData: Prisma.MemeSubmissionUncheckedCreateInput = {
      channelId: String(channelId),
      submitterUserId: req.userId!,
      title: finalTitle,
      type: 'video',
      fileUrlTemp: finalFilePath,
      sourceKind: 'upload',
      status: 'approved',
      memeAssetId,
      fileHash,
      durationMs: durationMsSafe > 0 ? durationMsSafe : null,
      aiStatus: 'pending',
    };
    const submission = await prisma.memeSubmission.create({
      data: ownerImportSubmissionData,
    });
    logger.info('ai.enqueue', { submissionId: submission.id, reason: 'owner_import' });
    void enqueueAiModerationJob(submission.id, { reason: 'owner_import' });
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
    ...meme,
    isDirectApproval: true,
    channelMemeId,
    memeAssetId,
    isRestored: false,
    status: 'approved',
    deletedAt: null,
  });
}
