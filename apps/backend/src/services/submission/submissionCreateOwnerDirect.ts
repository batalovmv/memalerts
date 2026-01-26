import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import type { Prisma } from '@prisma/client';
import type { SubmissionDeps } from './submissionTypes.js';
import { enqueueAiModerationJob } from '../../queues/aiModerationQueue.js';
import { logger } from '../../utils/logger.js';
import { logFileUpload } from '../../utils/auditLogger.js';
import { makeAutoDescription } from '../../utils/ai/description.js';
import { generateTagNames } from '../../utils/ai/tagging.js';
import { ensureMemeAssetVariants } from '../memeAsset/ensureVariants.js';

export async function handleOwnerDirectSubmission(opts: {
  deps: SubmissionDeps;
  req: AuthRequest;
  res: Response;
  channelId: string;
  defaultPriceCoins: number | null;
  finalTitle: string;
  userProvidedTitle: boolean;
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

  if (!fileHash) {
    res.status(422).json({
      errorCode: 'FILE_HASH_REQUIRED',
      error: 'File hash is required for direct approval',
      requestId: req.requestId,
    });
    return true;
  }

  const runOwnerCreateTx = async () =>
    transaction(async (txRepos) => {
      const existingAsset = await txRepos.memes.asset.findFirst({
        where: { fileHash },
        select: { id: true },
      });

      let memeAssetId = existingAsset?.id ?? null;
      if (!memeAssetId) {
        memeAssetId = (
          await txRepos.memes.asset.create({
            data: {
              type: 'video',
              fileUrl: finalFilePath,
              fileHash,
              durationMs,
              createdById: req.userId!,
            },
            select: { id: true },
          })
        ).id;
      }
      if (!memeAssetId) throw new Error('MEME_ASSET_CREATE_FAILED');

      const cm = await txRepos.memes.channelMeme.upsert({
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

  try {
    if (userProvidedTitle && memeAssetId) {
      const fallbackDesc = makeAutoDescription({ title: finalTitle, transcript: null, labels: [] });
      const fallbackTags = generateTagNames({ title: finalTitle, transcript: null, labels: [] }).tagNames;
      const fallbackSearchText = [finalTitle, fallbackTags.join(' '), fallbackDesc || '']
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .join('\n')
        .slice(0, 4000);

      const asset = await memes.asset.findUnique({
        where: { id: memeAssetId },
        select: { aiAutoDescription: true, aiAutoTagNames: true, aiSearchText: true },
      });
      const existingTags = Array.isArray(asset?.aiAutoTagNames) ? asset.aiAutoTagNames : [];
      const hasAiDesc = !!asset?.aiAutoDescription;
      const hasAiTags = existingTags.length > 0;
      const updateData: Prisma.MemeAssetUpdateInput = {};
      if (!hasAiDesc && fallbackDesc) updateData.aiAutoDescription = String(fallbackDesc).slice(0, 2000);
      if (!hasAiTags && fallbackTags.length > 0) updateData.aiAutoTagNames = fallbackTags;
      if (!asset?.aiSearchText && fallbackSearchText) updateData.aiSearchText = fallbackSearchText;

      if (Object.keys(updateData).length > 0) {
        await memes.asset.update({ where: { id: memeAssetId }, data: updateData });
      }
    }
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

  if (memeAssetId) {
    void ensureMemeAssetVariants({
      memeAssetId,
      sourceFileUrl: finalFilePath,
      sourceFileHash: fileHash,
      sourceDurationMs: durationMs > 0 ? durationMs : null,
    }).catch((error) => {
      logger.warn('submission.owner.ensure_variants_failed', {
        requestId: req.requestId ?? null,
        channelId: String(channelId),
        memeAssetId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    });
  }

  res.status(201).json({
    isDirectApproval: true,
    isRestored: false,
    channelMemeId,
    memeAssetId,
    status: 'approved',
    deletedAt: null,
  });
  return true;
}
