import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import type { Meme, Prisma } from '@prisma/client';
import type { SubmissionDeps } from './submissionTypes.js';
import { enqueueAiModerationJob } from '../../queues/aiModerationQueue.js';
import { logger } from '../../utils/logger.js';
import { decrementFileHashReference } from '../../utils/fileHash.js';
import { makeAutoDescription } from '../../utils/ai/description.js';
import { generateTagNames } from '../../utils/ai/tagging.js';

export type ExistingAssetResult = {
  handled: boolean;
  fileHashRefAdded: boolean;
};

export async function handleExistingAssetForUpload(opts: {
  deps: SubmissionDeps;
  req: AuthRequest;
  res: Response;
  channelId: string;
  isOwner: boolean;
  finalTitle: string;
  userProvidedTitle: boolean;
  fileHash: string | null;
  contentHash: string | null;
  fileHashRefAdded: boolean;
}): Promise<ExistingAssetResult> {
  const { deps, req, res, channelId, isOwner, finalTitle, userProvidedTitle, fileHash, contentHash } = opts;
  let fileHashRefAdded = opts.fileHashRefAdded;

  if (!fileHash && !contentHash) {
    return { handled: false, fileHashRefAdded };
  }

  const { memes, transaction, submissions, channels } = deps;

  const existingAsset = await memes.asset.findFirst({
    where: contentHash ? { contentHash } : { fileHash },
    select: {
      id: true,
      type: true,
      fileUrl: true,
      playFileUrl: true,
      fileHash: true,
      contentHash: true,
      durationMs: true,
      aiStatus: true,
      aiAutoDescription: true,
      aiAutoTagNamesJson: true,
      aiSearchText: true,
      purgeRequestedAt: true,
      purgedAt: true,
    },
  });

  if (!existingAsset) return { handled: false, fileHashRefAdded };

  if (existingAsset.purgeRequestedAt || existingAsset.purgedAt) {
    if (fileHashRefAdded && fileHash) {
      try {
        await decrementFileHashReference(fileHash);
        fileHashRefAdded = false;
      } catch {
        // ignore
      }
    }
    res.status(410).json({
      errorCode: 'ASSET_PURGED_OR_QUARANTINED',
      error: 'This meme was deleted and cannot be uploaded again',
      requestId: req.requestId,
      details: {
        legacyErrorCode: 'MEME_ASSET_DELETED',
        fileHash,
        memeAssetId: existingAsset.id,
        purgeRequestedAt: existingAsset.purgeRequestedAt,
        purgedAt: existingAsset.purgedAt,
      },
    });
    return { handled: true, fileHashRefAdded };
  }

  const existingCm = await memes.channelMeme.findUnique({
    where: { channelId_memeAssetId: { channelId: String(channelId), memeAssetId: existingAsset.id } },
    select: { id: true, deletedAt: true, legacyMemeId: true },
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
    res.status(409).json({
      errorCode: 'ALREADY_IN_CHANNEL',
      error: 'This meme is already in your channel',
      requestId: req.requestId,
    });
    return { handled: true, fileHashRefAdded };
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

    const channel = await channels.findUnique({
      where: { id: channelId },
      select: { defaultPriceCoins: true },
    });
    const defaultPrice = channel?.defaultPriceCoins ?? 100;
    const now = new Date();

    const restored = await transaction(async (txRepos) => {
      const restored = await txRepos.memes.channelMeme.update({
        where: { id: existingCm.id },
        data: {
          status: 'approved',
          deletedAt: null,
          title: finalTitle,
          priceCoins: defaultPrice,
          approvedByUserId: req.userId!,
          approvedAt: now,
        },
        select: { id: true, legacyMemeId: true, memeAssetId: true },
      });

      const legacyData: Prisma.MemeUncheckedCreateInput = {
        channelId,
        title: finalTitle,
        type: existingAsset.type,
        fileUrl: existingAsset.playFileUrl ?? existingAsset.fileUrl ?? '',
        fileHash: existingAsset.fileHash,
        durationMs: existingAsset.durationMs,
        priceCoins: defaultPrice,
        status: 'approved',
        deletedAt: null,
        createdByUserId: req.userId!,
        approvedByUserId: req.userId!,
      };

      let legacy: Meme | null = null;
      if (restored.legacyMemeId) {
        try {
          legacy = await txRepos.memes.meme.update({
            where: { id: restored.legacyMemeId },
            data: legacyData,
          });
        } catch (error) {
          const errorCode = typeof error === 'object' && error !== null ? (error as { code?: string }).code : null;
          if (errorCode === 'P2025') {
            legacy = await txRepos.memes.meme.create({ data: legacyData });
            await txRepos.memes.channelMeme.update({
              where: { id: restored.id },
              data: { legacyMemeId: legacy.id },
            });
          } else {
            throw error;
          }
        }
      } else {
        legacy = await txRepos.memes.meme.create({ data: legacyData });
        await txRepos.memes.channelMeme.update({
          where: { id: restored.id },
          data: { legacyMemeId: legacy.id },
        });
      }

      return restored;
    });

    const fallbackDesc = userProvidedTitle
      ? makeAutoDescription({ title: finalTitle, transcript: null, labels: [] })
      : null;
    const fallbackTags = userProvidedTitle
      ? generateTagNames({ title: finalTitle, transcript: null, labels: [] }).tagNames
      : [];
    const fallbackSearchText = fallbackDesc ? String(fallbackDesc).slice(0, 4000) : null;

    const fallbackUpdate: Prisma.ChannelMemeUpdateArgs['data'] = {
      aiAutoDescription: fallbackDesc ? String(fallbackDesc).slice(0, 2000) : null,
      aiAutoTagNamesJson: fallbackTags,
      searchText: fallbackSearchText,
    };
    await memes.channelMeme.update({
      where: { id: restored.id },
      data: fallbackUpdate,
    });

    try {
      if (existingAsset.fileUrl) {
        const existingAssetDuration =
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
          durationMs: existingAssetDuration,
          aiStatus: 'pending',
        };
        const submission = await submissions.create({
          data: ownerRestoreSubmissionData,
        });
        logger.info('ai.enqueue', { submissionId: submission.id, reason: 'owner_restore' });
        void enqueueAiModerationJob(submission.id, { reason: 'owner_restore' });
      }
    } catch (e: unknown) {
      logger.warn('submission.ai.enqueue_failed', {
        requestId: req.requestId ?? null,
        userId: req.userId ?? null,
        channelId: String(channelId),
        reason: 'memeSubmission_create_failed',
        errorMessage: (e as Error)?.message || String(e),
      });
    }

    res.status(201).json({
      isDirectApproval: true,
      channelMemeId: restored.id,
      memeAssetId: restored.memeAssetId,
      sourceKind: 'upload',
      isRestored: true,
      status: 'approved',
      deletedAt: null,
    });
    return { handled: true, fileHashRefAdded };
  }

  return { handled: false, fileHashRefAdded };
}
