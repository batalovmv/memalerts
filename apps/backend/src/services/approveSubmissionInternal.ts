import type { Prisma } from '@prisma/client';
import { getOrCreateTags } from '../utils/tags.js';

export type ApproveSubmissionInternalArgs = {
  tx: Prisma.TransactionClient;
  submissionId: string;
  approvedByUserId: string | null;
  // Resolved values (caller is responsible for heavy work: dedup/hash/path validation/etc).
  resolved: {
    finalFileUrl: string;
    fileHash: string | null;
    durationMs: number;
    priceCoins: number;
    tagNames?: string[];
  };
};

export async function approveSubmissionInternal(args: ApproveSubmissionInternalArgs): Promise<{
  legacyMeme: any;
  alreadyApproved: boolean;
  memeAssetId: string | null;
  channelMemeId: string | null;
}> {
  const { tx, submissionId, approvedByUserId, resolved } = args;

  const submission = await tx.memeSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      channelId: true,
      submitterUserId: true,
      title: true,
      type: true,
      status: true,
      sourceKind: true,
      memeAssetId: true,
    },
  });

  if (!submission) throw new Error('SUBMISSION_NOT_FOUND');

  // Idempotency: one submission -> one approve.
  if (submission.status === 'approved') {
    // Best-effort: try to return an existing legacy meme for backward compatible responses.
    let legacy: any | null = null;
    let memeAssetId: string | null = submission.memeAssetId ?? null;
    let channelMemeId: string | null = null;

    if (memeAssetId) {
      const cm = await tx.channelMeme.findUnique({
        where: { channelId_memeAssetId: { channelId: submission.channelId, memeAssetId } },
        select: { id: true, legacyMemeId: true },
      });
      channelMemeId = cm?.id ?? null;
      if (cm?.legacyMemeId) {
        legacy = await tx.meme.findUnique({ where: { id: cm.legacyMemeId } });
      }
    }

    return { legacyMeme: legacy, alreadyApproved: true, memeAssetId, channelMemeId };
  }

  const tagNames = Array.isArray(resolved.tagNames) ? resolved.tagNames : [];
  const tagIds = tagNames.length > 0 ? await getOrCreateTags(tagNames) : [];

  // Create legacy Meme (kept for back-compat).
  const memeData: any = {
    channelId: submission.channelId,
    title: submission.title,
    type: submission.type,
    fileUrl: resolved.finalFileUrl,
    fileHash: resolved.fileHash,
    durationMs: resolved.durationMs,
    priceCoins: resolved.priceCoins,
    status: 'approved',
    createdByUserId: submission.submitterUserId,
    approvedByUserId: approvedByUserId,
  };

  if (tagIds.length > 0) {
    memeData.tags = { create: tagIds.map((tagId) => ({ tagId })) };
  }

  const legacyMeme = await tx.meme.create({
    data: memeData,
    include: {
      createdBy: {
        select: {
          id: true,
          displayName: true,
          channel: { select: { slug: true } },
        },
      },
      ...(tagIds.length > 0
        ? {
            tags: {
              include: {
                tag: true,
              },
            },
          }
        : {}),
    },
  });

  // Dual-write to MemeAsset + ChannelMeme.
  const existingAsset =
    resolved.fileHash !== null
      ? await tx.memeAsset.findFirst({ where: { fileHash: resolved.fileHash }, select: { id: true } })
      : await tx.memeAsset.findFirst({
          where: { fileHash: null, fileUrl: resolved.finalFileUrl, type: submission.type, durationMs: resolved.durationMs },
          select: { id: true },
        });

  const memeAssetId =
    existingAsset?.id ??
    (
      await tx.memeAsset.create({
        data: {
          type: submission.type,
          fileUrl: resolved.finalFileUrl,
          fileHash: resolved.fileHash,
          durationMs: resolved.durationMs,
          createdByUserId: submission.submitterUserId || null,
        },
        select: { id: true },
      })
    ).id;

  const cm = await tx.channelMeme.upsert({
    where: { channelId_memeAssetId: { channelId: submission.channelId, memeAssetId } },
    create: {
      channelId: submission.channelId,
      memeAssetId,
      legacyMemeId: legacyMeme.id,
      status: 'approved',
      title: submission.title,
      priceCoins: resolved.priceCoins,
      addedByUserId: submission.submitterUserId || null,
      approvedByUserId: approvedByUserId,
      approvedAt: new Date(),
    },
    update: {
      legacyMemeId: legacyMeme.id,
      status: 'approved',
      title: submission.title,
      priceCoins: resolved.priceCoins,
      approvedByUserId: approvedByUserId,
      approvedAt: new Date(),
      deletedAt: null,
    },
    select: { id: true },
  });

  // Mark submission approved + persist memeAssetId for idempotency and future lookups.
  await tx.memeSubmission.update({
    where: { id: submissionId },
    data: { status: 'approved', memeAssetId },
  });

  return { legacyMeme, alreadyApproved: false, memeAssetId, channelMemeId: cm.id };
}

import { prisma } from '../lib/prisma.js';
import { getOrCreateTags } from '../utils/tags.js';
import {
  calculateFileHash,
  decrementFileHashReference,
  findOrCreateFileHash,
  getFileStats,
  getFileHashByPath,
  incrementFileHashReference,
} from '../utils/fileHash.js';
import { validatePathWithinDirectory } from '../utils/pathSecurity.js';
import { getVideoMetadata } from '../utils/videoValidator.js';
import { debugLog } from '../utils/debug.js';
import fs from 'fs';
import path from 'path';

export type ApproveSubmissionInternalInput = {
  submissionId: string;
  channelId: string;
  approverUserId: string;
  body: {
    priceCoins?: number;
    durationMs?: number;
    tags?: string[];
  };
};

export type ApproveSubmissionInternalResult = {
  meme: any;
  submissionRewardEvent: any | null;
};

export async function approveSubmissionInternal(input: ApproveSubmissionInternalInput): Promise<ApproveSubmissionInternalResult> {
  const { submissionId: id, channelId, approverUserId, body } = input;

  let submission: any;
  let submissionRewardEvent: any = null;

  const meme = await prisma.$transaction(
    async (tx) => {
      // Get submission WITHOUT tags to avoid transaction abort if MemeSubmissionTag table doesn't exist.
      submission = await tx.memeSubmission.findUnique({ where: { id } });
      if (submission) {
        submission.tags = [];
        try {
          submission.tags = await (tx as any).memeSubmissionTag.findMany({
            where: { submissionId: id },
            include: { tag: { select: { name: true } } },
          });
        } catch (err: any) {
          if (!(err?.code === 'P2021' && err?.meta?.table === 'public.MemeSubmissionTag')) {
            throw err;
          }
          submission.tags = [];
        }
      }

      if (!submission) throw new Error('SUBMISSION_NOT_FOUND');
      if (submission.channelId !== channelId) throw new Error('SUBMISSION_FORBIDDEN');
      if (submission.status !== 'pending') throw new Error('SUBMISSION_NOT_PENDING');

      const channel = await tx.channel.findUnique({
        where: { id: channelId },
        select: {
          defaultPriceCoins: true,
          slug: true,
          submissionRewardCoins: true, // legacy
          submissionRewardCoinsUpload: true,
          submissionRewardCoinsPool: true,
          submissionRewardOnlyWhenLive: true, // legacy (ignored)
        },
      });
      if (!channel) throw new Error('CHANNEL_NOT_FOUND');

      const defaultPrice = (channel as any).defaultPriceCoins ?? 100;

      // Choose reward depending on sourceKind (best-effort).
      const sourceKind = String(submission.sourceKind || '').toLowerCase();
      const rewardForApproval =
        sourceKind === 'pool'
          ? (channel as any).submissionRewardCoinsPool ?? (channel as any).submissionRewardCoins ?? 0
          : (channel as any).submissionRewardCoinsUpload ?? (channel as any).submissionRewardCoins ?? 0;

      // Determine file path and validate local uploads path.
      let filePath: string | null = null;
      let finalFileUrl: string = submission.fileUrlTemp;
      let fileHash: string | null = null;

      // Imported memes keep using their original sourceUrl as fileUrl.
      if (submission.sourceUrl) {
        finalFileUrl = submission.sourceUrl;
      } else {
        // Local upload: validate path is within uploads directory and file exists.
        const uploadUrl = String(submission.fileUrlTemp || '');
        const uploadsDir = path.join(process.cwd(), 'uploads');
        const abs = path.join(process.cwd(), uploadUrl);
        validatePathWithinDirectory(abs, uploadsDir);
        filePath = abs;

        // Try to retrieve fileHash from FileHash table by path first (fast path).
        const existingHash = await getFileHashByPath(uploadUrl);
        if (existingHash) {
          fileHash = existingHash;
          const existingAsset = await tx.memeAsset.findFirst({
            where: { fileHash: existingHash },
            select: { purgeRequestedAt: true, purgedAt: true },
          });
          if (existingAsset?.purgeRequestedAt || existingAsset?.purgedAt) {
            throw new Error('MEME_ASSET_DELETED');
          }
          await incrementFileHashReference(existingHash);
        } else if (filePath && fs.existsSync(filePath)) {
          // File exists but not in FileHash - calculate hash and deduplicate with timeout
          try {
            const hashPromise = calculateFileHash(filePath);
            const hashTimeout = new Promise<string>((_, reject) => {
              setTimeout(() => reject(new Error('Hash calculation timeout')), 10000);
            });

            const hash = await Promise.race([hashPromise, hashTimeout]);
            const stats = await getFileStats(filePath);
            const result = await findOrCreateFileHash(filePath, hash, stats.mimeType, stats.size);
            finalFileUrl = result.filePath;
            fileHash = hash;
            debugLog(`File deduplication on approve: ${result.isNew ? 'new file' : 'duplicate found'}, hash: ${hash}`);
          } catch (error: any) {
            console.error('File hash calculation failed during approve:', error.message);
            finalFileUrl = submission.fileUrlTemp;
            fileHash = null;
          }
        } else {
          throw new Error('Uploaded file not found');
        }
      }

      // Safety: forbid approving if this hash is in quarantine/purged.
      if (fileHash) {
        const blocked = await tx.memeAsset.findFirst({
          where: { fileHash, OR: [{ purgeRequestedAt: { not: null } }, { purgedAt: { not: null } }] },
          select: { id: true },
        });
        if (blocked) {
          try {
            await decrementFileHashReference(fileHash);
          } catch {
            // ignore
          }
          throw new Error('MEME_ASSET_DELETED');
        }
      }

      // Tags priority: body.tags -> submission.tags -> aiAutoTagNamesJson
      const tagNames =
        body.tags && body.tags.length > 0
          ? body.tags
          : submission.tags && Array.isArray(submission.tags) && submission.tags.length > 0
            ? submission.tags.map((st: any) => st.tag?.name || st.tag).filter(Boolean)
            : Array.isArray(submission?.aiAutoTagNamesJson)
              ? (submission.aiAutoTagNamesJson as any[]).filter((t) => typeof t === 'string' && t.length > 0)
              : [];

      let tagIds: string[] = [];
      if (tagNames.length > 0) {
        try {
          const tagsPromise = getOrCreateTags(tagNames);
          const tagsTimeout = new Promise<string[]>((resolve) => {
            setTimeout(() => {
              console.warn('Tags creation timeout, proceeding without tags');
              resolve([]);
            }, 3000);
          });
          tagIds = await Promise.race([tagsPromise, tagsTimeout]);
        } catch (error: any) {
          console.warn('Error creating tags, proceeding without tags:', error.message);
          tagIds = [];
        }
      }

      // Duration: body.durationMs as hint, but prefer ffprobe for local uploads.
      const STANDARD_DURATION_MS = 15000;
      let durationMs = body.durationMs || STANDARD_DURATION_MS;
      if (!submission.sourceUrl && filePath && fs.existsSync(filePath)) {
        try {
          const metadata = await getVideoMetadata(filePath);
          if (metadata && metadata.duration > 0) durationMs = Math.round(metadata.duration * 1000);
        } catch (error: any) {
          console.warn('Failed to get video duration, using default:', error.message);
          durationMs = body.durationMs || STANDARD_DURATION_MS;
        }
      }

      const priceCoins = body.priceCoins || defaultPrice;

      await tx.memeSubmission.update({
        where: { id },
        data: { status: 'approved' },
      });

      const memeData: any = {
        channelId: submission.channelId,
        title: submission.title,
        type: submission.type,
        fileUrl: finalFileUrl,
        fileHash,
        durationMs,
        priceCoins,
        status: 'approved',
        createdByUserId: submission.submitterUserId,
        approvedByUserId: approverUserId,
      };
      if (tagIds.length > 0) {
        memeData.tags = { create: tagIds.map((tagId) => ({ tagId })) };
      }

      const createdMeme = await tx.meme.create({
        data: memeData,
        include: {
          tags: { include: { tag: true } },
        },
      });

      // Dual-write MemeAsset + ChannelMeme (best-effort; do not fail approval).
      try {
        const existingAsset =
          fileHash
            ? await tx.memeAsset.findFirst({ where: { fileHash }, select: { id: true } })
            : await tx.memeAsset.findFirst({
                where: { fileHash: null, fileUrl: finalFileUrl, type: submission.type, durationMs },
                select: { id: true },
              });

        const assetId =
          existingAsset?.id ??
          (
            await tx.memeAsset.create({
              data: {
                type: submission.type,
                fileUrl: finalFileUrl,
                fileHash,
                durationMs,
                createdByUserId: submission.submitterUserId || null,
              },
              select: { id: true },
            })
          ).id;

        await tx.channelMeme.upsert({
          where: { channelId_memeAssetId: { channelId: submission.channelId, memeAssetId: assetId } },
          create: {
            channelId: submission.channelId,
            memeAssetId: assetId,
            legacyMemeId: createdMeme.id,
            status: 'approved',
            title: submission.title,
            priceCoins,
            addedByUserId: submission.submitterUserId || null,
            approvedByUserId: approverUserId,
            approvedAt: new Date(),
          },
          update: {
            legacyMemeId: createdMeme.id,
            status: 'approved',
            title: submission.title,
            priceCoins,
            approvedByUserId: approverUserId,
            approvedAt: new Date(),
            deletedAt: null,
          },
        });
      } catch (e) {
        console.warn('[approveSubmissionInternal] Dual-write to MemeAsset/ChannelMeme failed (ignored):', (e as any)?.message);
      }

      // Reward submitter for approved submission (per-channel setting).
      if (rewardForApproval > 0 && submission.submitterUserId && submission.submitterUserId !== approverUserId) {
        const updatedWallet = await tx.wallet.upsert({
          where: {
            userId_channelId: {
              userId: submission.submitterUserId,
              channelId: submission.channelId,
            },
          },
          create: { userId: submission.submitterUserId, channelId: submission.channelId, balance: rewardForApproval },
          update: { balance: { increment: rewardForApproval } },
          select: { balance: true },
        });

        submissionRewardEvent = {
          userId: submission.submitterUserId,
          channelId: submission.channelId,
          balance: updatedWallet.balance,
          delta: rewardForApproval,
          reason: 'submission_approved_reward',
          channelSlug: channel?.slug,
        };
      }

      return createdMeme;
    },
    { timeout: 30000, maxWait: 10000 }
  ).catch((txError: any) => {
    debugLog('[DEBUG] Transaction failed', {
      submissionId: id,
      errorMessage: txError?.message,
      errorName: txError?.name,
      errorCode: txError?.code,
    });
    throw txError;
  });

  return { meme, submissionRewardEvent };
}


