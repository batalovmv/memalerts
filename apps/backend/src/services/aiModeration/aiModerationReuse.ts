import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import {
  extractTitleTokens,
  hasReusableAiTags,
  isEffectivelyEmptyAiDescription,
  normalizeAiText,
} from './aiModerationHelpers.js';
import type { AiModerationSubmission } from './aiModerationTypes.js';

export async function tryReuseAiResults(opts: {
  submission: AiModerationSubmission;
  fileHash: string;
  contentHash?: string | null;
  now: Date;
}): Promise<boolean> {
  const { submission, fileHash, contentHash, now } = opts;

  const existingAsset = await prisma.memeAsset.findFirst({
    where: contentHash ? { contentHash, aiStatus: 'done' } : { fileHash, aiStatus: 'done' },
    select: {
      id: true,
      aiAutoTitle: true,
      aiAutoDescription: true,
      aiAutoTagNamesJson: true,
      aiTranscript: true,
      aiSearchText: true,
    },
  });

  if (!existingAsset) return false;

  const hasReusableDescription = !isEffectivelyEmptyAiDescription(existingAsset.aiAutoDescription, submission.title);
  const hasReusableTags = hasReusableAiTags(
    existingAsset.aiAutoTagNamesJson,
    submission.title,
    existingAsset.aiAutoDescription
  );
  if (!hasReusableDescription && !hasReusableTags) {
    logger.info('ai_moderation.dedup.skip_reuse_placeholder', {
      submissionId: submission.id,
      fileHash,
      contentHash: contentHash ?? null,
      memeAssetId: existingAsset.id,
      reason: 'placeholder_ai_fields',
    });
    return false;
  }

  const tagNamesJson =
    existingAsset.aiAutoTagNamesJson === null
      ? Prisma.DbNull
      : (existingAsset.aiAutoTagNamesJson as Prisma.InputJsonValue);
  const assetAiAutoTagNamesNorm = Array.isArray(existingAsset.aiAutoTagNamesJson)
    ? (existingAsset.aiAutoTagNamesJson as unknown[]).map((t) => normalizeAiText(String(t ?? ''))).filter(Boolean)
    : null;
  const reuseModelVersions: Prisma.JsonObject = {
    pipelineVersion: 'v3-reuse-memeasset',
    reuse: {
      hasReusableDescription,
      hasReusableTags,
      titleTokens: extractTitleTokens(submission.title),
      assetAiAutoDescriptionNorm: normalizeAiText(String(existingAsset.aiAutoDescription ?? '')),
      assetAiAutoTagNamesNorm,
    },
  };
  await prisma.memeSubmission.update({
    where: { id: submission.id },
    data: {
      aiStatus: 'done',
      aiDecision: null,
      aiRiskScore: null,
      aiLabelsJson: Prisma.DbNull,
      aiTranscript: existingAsset.aiTranscript ?? null,
      aiAutoTagNamesJson: tagNamesJson,
      aiAutoDescription: existingAsset.aiAutoDescription ?? null,
      aiModelVersionsJson: reuseModelVersions,
      aiCompletedAt: now,
      aiError: null,
      aiNextRetryAt: null,
      aiProcessingStartedAt: null,
      aiLockedBy: null,
      aiLockExpiresAt: null,
    },
  });

  const assetId = submission.memeAssetId ?? existingAsset.id;
  const fallbackSearchText = (() => {
    const tagNames = Array.isArray(existingAsset.aiAutoTagNamesJson)
      ? (existingAsset.aiAutoTagNamesJson as unknown[]).map((t) => normalizeAiText(String(t ?? ''))).filter(Boolean)
      : [];
    const parts = [
      existingAsset.aiAutoTitle ? String(existingAsset.aiAutoTitle) : submission.title ? String(submission.title) : '',
      tagNames.length > 0 ? tagNames.join(' ') : '',
      existingAsset.aiAutoDescription ? String(existingAsset.aiAutoDescription) : '',
      existingAsset.aiTranscript ? String(existingAsset.aiTranscript) : '',
    ]
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    const merged = parts.join('\n');
    return merged ? merged.slice(0, 4000) : null;
  })();
  await prisma.channelMeme.updateMany({
    where: { channelId: submission.channelId, memeAssetId: assetId },
    data: {
      aiAutoDescription: existingAsset.aiAutoDescription ?? null,
      aiAutoTagNamesJson: tagNamesJson,
      searchText:
        existingAsset.aiSearchText ?? fallbackSearchText,
    },
  });

  if (existingAsset.aiAutoTitle) {
    await prisma.channelMeme.updateMany({
      where: { channelId: submission.channelId, memeAssetId: assetId, title: submission.title },
      data: { title: String(existingAsset.aiAutoTitle).slice(0, 80) },
    });
  }

  return true;
}
