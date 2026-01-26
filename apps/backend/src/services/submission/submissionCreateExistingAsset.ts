import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import type { Prisma } from '@prisma/client';
import type { SubmissionDeps } from './submissionTypes.js';
import { enqueueAiModerationJob } from '../../queues/aiModerationQueue.js';
import { logger } from '../../utils/logger.js';
import { decrementFileHashReference } from '../../utils/fileHash.js';
import { makeAutoDescription } from '../../utils/ai/description.js';
import { generateTagNames } from '../../utils/ai/tagging.js';

function buildSearchText(opts: { title: string; tags: string[]; description: string | null }): string | null {
  const parts = [
    opts.title ? String(opts.title) : '',
    Array.isArray(opts.tags) && opts.tags.length > 0 ? opts.tags.join(' ') : '',
    opts.description ? String(opts.description) : '',
  ]
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  const merged = parts.join('\n');
  return merged ? merged.slice(0, 4000) : null;
}

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
  fileHashRefAdded: boolean;
}): Promise<ExistingAssetResult> {
  const { deps, req, res, channelId, isOwner, finalTitle, userProvidedTitle, fileHash } = opts;
  let fileHashRefAdded = opts.fileHashRefAdded;

  if (!fileHash) {
    return { handled: false, fileHashRefAdded };
  }

  const { memes, transaction, submissions, channels } = deps;

  const existingAsset = await memes.asset.findFirst({
    where: { fileHash },
    select: {
      id: true,
      type: true,
      fileUrl: true,
      fileHash: true,
      durationMs: true,
      aiAutoDescription: true,
      aiAutoTagNames: true,
      aiSearchText: true,
      status: true,
      deletedAt: true,
    },
  });

  if (!existingAsset) return { handled: false, fileHashRefAdded };

  if (existingAsset.status !== 'active' || existingAsset.deletedAt) {
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
        fileHash,
        memeAssetId: existingAsset.id,
        status: existingAsset.status,
        deletedAt: existingAsset.deletedAt,
      },
    });
    return { handled: true, fileHashRefAdded };
  }

  const existingCm = await memes.channelMeme.findUnique({
    where: { channelId_memeAssetId: { channelId: String(channelId), memeAssetId: existingAsset.id } },
    select: { id: true, deletedAt: true },
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

    const restored = await transaction(async (txRepos) => {
      const restored = await txRepos.memes.channelMeme.update({
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
        const fallbackSearchText = buildSearchText({
          title: finalTitle,
          tags: fallbackTags,
          description: fallbackDesc,
        });

        const hasAiDesc = !!existingAsset.aiAutoDescription;
        const hasAiTags = Array.isArray(existingAsset.aiAutoTagNames) && existingAsset.aiAutoTagNames.length > 0;
        const updateData: Prisma.MemeAssetUpdateInput = {};
        if (!hasAiDesc && fallbackDesc) updateData.aiAutoDescription = String(fallbackDesc).slice(0, 2000);
        if (!hasAiTags && fallbackTags.length > 0) updateData.aiAutoTagNames = fallbackTags;
        if (!existingAsset.aiSearchText && fallbackSearchText) updateData.aiSearchText = fallbackSearchText;

        if (Object.keys(updateData).length > 0) {
          await txRepos.memes.asset.update({
            where: { id: existingAsset.id },
            data: updateData,
          });
        }
      }

      return restored;
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
