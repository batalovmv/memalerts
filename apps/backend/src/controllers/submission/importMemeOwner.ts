import type { Prisma } from '@prisma/client';
import type { AuthRequest } from '../../middleware/auth.js';
import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { makeAutoDescription } from '../../utils/ai/description.js';
import { generateTagNames } from '../../utils/ai/tagging.js';
import { enqueueAiModerationJob } from '../../queues/aiModerationQueue.js';
import { logger } from '../../utils/logger.js';
import { ensureMemeAssetVariants } from '../../services/memeAsset/ensureVariants.js';

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
  void tagIds;

  const defaultPrice = channel.defaultPriceCoins ?? 100;
  const durationMsSafe = Math.max(0, Math.min(detectedDurationMs ?? 0, 15000));

  if (!fileHash) {
    return res.status(422).json({
      errorCode: 'FILE_HASH_REQUIRED',
      error: 'File hash is required for direct approval',
      requestId: req.requestId,
    });
  }

  const runOwnerCreateTx = async () =>
    prisma.$transaction(async (tx) => {
      const existingAsset = await tx.memeAsset.findFirst({
        where: { fileHash },
        select: { id: true },
      });

      let memeAssetId = existingAsset?.id ?? null;
      if (!memeAssetId) {
        memeAssetId = (
          await tx.memeAsset.create({
            data: {
              type: 'video',
              fileUrl: finalFilePath,
              fileHash,
              durationMs: durationMsSafe,
              createdById: req.userId!,
            },
            select: { id: true },
          })
        ).id;
      }
      if (!memeAssetId) throw new Error('MEME_ASSET_CREATE_FAILED');

      const cm = await tx.channelMeme.upsert({
        where: { channelId_memeAssetId: { channelId: String(channelId), memeAssetId } },
        create: {
          channelId: String(channelId),
          memeAssetId,
          status: 'approved',
          title: finalTitle,
          priceCoins: defaultPrice,
        },
        update: {
          status: 'approved',
          title: finalTitle,
          priceCoins: defaultPrice,
          deletedAt: null,
        },
        select: { id: true },
      });

      return { memeAssetId, channelMemeId: cm.id };
    });

  let memeAssetId: string | null = null;
  let channelMemeId: string | null = null;
  try {
    const resTx = await runOwnerCreateTx();
    memeAssetId = resTx.memeAssetId;
    channelMemeId = resTx.channelMemeId;
  } catch (error) {
    const errorCode = typeof error === 'object' && error !== null ? (error as { code?: string }).code : null;
    if (errorCode === 'P2002') {
      return res.status(409).json({
        errorCode: 'ALREADY_IN_CHANNEL',
        error: 'This meme is already in your channel',
        requestId: req.requestId,
      });
    } else {
      throw error;
    }
  }

  try {
    if (userProvidedTitle && memeAssetId) {
      const fallbackDesc = makeAutoDescription({ title: finalTitle, transcript: null, labels: [] });
      const fallbackTags = generateTagNames({ title: finalTitle, transcript: null, labels: [] }).tagNames;
      const fallbackSearchText = [finalTitle, fallbackTags.join(' '), fallbackDesc || '']
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .join('\n')
        .slice(0, 4000);

      const asset = await prisma.memeAsset.findUnique({
        where: { id: memeAssetId },
        select: { aiAutoDescription: true, aiAutoTagNames: true, aiSearchText: true },
      });
      const existingTags = Array.isArray(asset?.aiAutoTagNames) ? asset.aiAutoTagNames : [];
      const updateData: Prisma.MemeAssetUpdateInput = {};
      if (!asset?.aiAutoDescription && fallbackDesc) updateData.aiAutoDescription = String(fallbackDesc).slice(0, 2000);
      if (existingTags.length === 0 && fallbackTags.length > 0) updateData.aiAutoTagNames = fallbackTags;
      if (!asset?.aiSearchText && fallbackSearchText) updateData.aiSearchText = fallbackSearchText;

      if (Object.keys(updateData).length > 0) {
        await prisma.memeAsset.update({ where: { id: memeAssetId }, data: updateData });
      }
    }
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

  if (memeAssetId) {
    void ensureMemeAssetVariants({
      memeAssetId,
      sourceFileUrl: finalFilePath,
      sourceFileHash: fileHash,
      sourceDurationMs: durationMsSafe > 0 ? durationMsSafe : null,
    }).catch((error) => {
      logger.warn('submission.owner_import.ensure_variants_failed', {
        requestId: req.requestId ?? null,
        channelId: String(channelId),
        memeAssetId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return res.status(201).json({
    isDirectApproval: true,
    channelMemeId,
    memeAssetId,
    isRestored: false,
    status: 'approved',
    deletedAt: null,
  });
}
