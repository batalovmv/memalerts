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
    contentHash?: string | null;
    durationMs: number;
    priceCoins: number;
    tagNames?: string[];
  };
};

type LegacyMeme = Awaited<ReturnType<Prisma.TransactionClient['meme']['findUnique']>>;

export async function approveSubmissionInternal(args: ApproveSubmissionInternalArgs): Promise<{
  legacyMeme: LegacyMeme | null;
  alreadyApproved: boolean;
  memeAssetId: string | null;
  channelMemeId: string | null;
}> {
  const { tx, submissionId, approvedByUserId, resolved } = args;

  const buildAiSearchText = (args: {
    title: string | null | undefined;
    tagNames: string[];
    description: string | null | undefined;
    transcript?: string | null | undefined;
  }): string | null => {
    const parts = [
      args.title ? String(args.title) : '',
      Array.isArray(args.tagNames) && args.tagNames.length > 0 ? args.tagNames.join(' ') : '',
      args.description ? String(args.description) : '',
      args.transcript ? String(args.transcript) : '',
    ]
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    const merged = parts.join('\n');
    return merged ? merged.slice(0, 4000) : null;
  };

  const submission = await tx.memeSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      channelId: true,
      submitterUserId: true,
      title: true,
      type: true,
      status: true,
      memeAssetId: true,
      aiAutoDescription: true,
      aiAutoTagNamesJson: true,
      aiTranscript: true,
    },
  });

  if (!submission) throw new Error('SUBMISSION_NOT_FOUND');

  // Idempotency: one submission -> one approve.
  if (submission.status === 'approved') {
    let legacy: LegacyMeme | null = null;
    const memeAssetId: string | null = submission.memeAssetId ?? null;
    let channelMemeId: string | null = null;

    if (memeAssetId) {
      const cm = await tx.channelMeme.findUnique({
        where: { channelId_memeAssetId: { channelId: submission.channelId, memeAssetId } },
        select: { id: true, legacyMemeId: true },
      });
      channelMemeId = cm?.id ?? null;
      if (cm?.legacyMemeId) legacy = await tx.meme.findUnique({ where: { id: cm.legacyMemeId } });
    }

    return { legacyMeme: legacy, alreadyApproved: true, memeAssetId, channelMemeId };
  }

  const tagNames = Array.isArray(resolved.tagNames) ? resolved.tagNames : [];
  const tagIds = tagNames.length > 0 ? await getOrCreateTags(tagNames) : [];

  const aiAutoDescription =
    typeof submission.aiAutoDescription === 'string'
      ? String(submission.aiAutoDescription).trim().slice(0, 2000) || null
      : null;
  const aiTranscript =
    typeof submission.aiTranscript === 'string' ? String(submission.aiTranscript).trim().slice(0, 50000) || null : null;

  const aiAutoTagNamesJson = submission.aiAutoTagNamesJson ?? null;
  const aiAutoTags =
    Array.isArray(aiAutoTagNamesJson) && aiAutoTagNamesJson.every((t) => typeof t === 'string')
      ? (aiAutoTagNamesJson as string[])
      : [];

  const memeData: Prisma.MemeUncheckedCreateInput = {
    channelId: submission.channelId,
    title: submission.title,
    type: submission.type,
    fileUrl: resolved.finalFileUrl,
    fileHash: resolved.fileHash,
    durationMs: resolved.durationMs,
    priceCoins: resolved.priceCoins,
    status: 'approved',
    createdByUserId: submission.submitterUserId,
    approvedByUserId,
  };

  if (tagIds.length > 0) memeData.tags = { create: tagIds.map((tagId) => ({ tagId })) };

  const legacyMeme = await tx.meme.create({
    data: memeData,
    include: {
      createdBy: { select: { id: true, displayName: true, channel: { select: { slug: true } } } },
      ...(tagIds.length > 0 ? { tags: { include: { tag: true } } } : {}),
    },
  });

  const existingAsset = resolved.contentHash
    ? await tx.memeAsset.findFirst({ where: { contentHash: resolved.contentHash }, select: { id: true } })
    : resolved.fileHash !== null
      ? await tx.memeAsset.findFirst({ where: { fileHash: resolved.fileHash }, select: { id: true } })
      : await tx.memeAsset.findFirst({
          where: {
            fileHash: null,
            fileUrl: resolved.finalFileUrl,
            type: submission.type,
            durationMs: resolved.durationMs,
          },
          select: { id: true },
        });

  let memeAssetId = existingAsset?.id ?? null;
  if (!memeAssetId) {
    try {
      memeAssetId = (
        await tx.memeAsset.create({
          data: {
            type: submission.type,
            fileUrl: resolved.finalFileUrl,
            fileHash: resolved.fileHash,
            contentHash: resolved.contentHash ?? undefined,
            durationMs: resolved.durationMs,
            createdByUserId: submission.submitterUserId || null,
          },
          select: { id: true },
        })
      ).id;
    } catch (error) {
      const errCode = typeof error === 'object' && error !== null ? (error as { code?: string }).code : null;
      if (errCode === 'P2002' && resolved.contentHash) {
        const existing = await tx.memeAsset.findFirst({
          where: { contentHash: resolved.contentHash },
          select: { id: true },
        });
        memeAssetId = existing?.id ?? null;
      } else {
        throw error;
      }
    }
  }
  if (!memeAssetId) throw new Error('MEME_ASSET_CREATE_FAILED');

  // Prefer AI-generated title if already available on the asset (dedup/pool reuse).
  const assetForTitle = await tx.memeAsset.findUnique({
    where: { id: memeAssetId },
    select: { aiAutoTitle: true },
  });
  const channelTitle = assetForTitle?.aiAutoTitle ? String(assetForTitle.aiAutoTitle).slice(0, 80) : submission.title;

  // Keep AI search text consistent with AI moderation persistence:
  // title + (AI tags + applied tags) + AI description + transcript.
  const mergedTagNames = Array.from(new Set([...(aiAutoTags || []), ...(tagNames || [])])).filter(Boolean);
  const aiSearchText = buildAiSearchText({
    title: channelTitle,
    tagNames: mergedTagNames,
    description: aiAutoDescription,
    transcript: aiTranscript,
  });

  // Best-effort: persist AI results globally on MemeAsset so future duplicates/pool adoptions can reuse them.
  // (Do not overwrite if already marked done.)
  try {
    const aiUpdateData: Prisma.MemeAssetUpdateManyMutationInput = {
      aiStatus: 'done',
      aiAutoDescription,
      aiAutoTagNamesJson: aiAutoTags.length > 0 ? aiAutoTags : undefined,
      aiTranscript: aiTranscript || undefined,
      aiSearchText,
      aiCompletedAt: new Date(),
    };
    await tx.memeAsset.updateMany({
      where: { id: memeAssetId, aiStatus: { not: 'done' } },
      data: aiUpdateData,
    });
  } catch {
    // ignore (back-compat if column missing on older DBs)
  }

  const cm = await tx.channelMeme.upsert({
    where: { channelId_memeAssetId: { channelId: submission.channelId, memeAssetId } },
    create: {
      channelId: submission.channelId,
      memeAssetId,
      legacyMemeId: legacyMeme.id,
      status: 'approved',
      title: channelTitle,
      searchText: aiSearchText,
      aiAutoDescription,
      aiAutoTagNamesJson: aiAutoTags.length > 0 ? aiAutoTags : undefined,
      priceCoins: resolved.priceCoins,
      addedByUserId: submission.submitterUserId || null,
      approvedByUserId,
      approvedAt: new Date(),
    },
    update: {
      legacyMemeId: legacyMeme.id,
      status: 'approved',
      title: channelTitle,
      searchText: aiSearchText,
      aiAutoDescription,
      aiAutoTagNamesJson: aiAutoTags.length > 0 ? aiAutoTags : undefined,
      priceCoins: resolved.priceCoins,
      approvedByUserId,
      approvedAt: new Date(),
      deletedAt: null,
    },
    select: { id: true },
  });

  await tx.memeSubmission.update({ where: { id: submissionId }, data: { status: 'approved', memeAssetId } });

  return { legacyMeme, alreadyApproved: false, memeAssetId, channelMemeId: cm.id };
}
