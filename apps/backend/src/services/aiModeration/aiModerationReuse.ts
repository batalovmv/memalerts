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
  now: Date;
}): Promise<boolean> {
  const { submission, fileHash, now } = opts;

  const existingAsset = await prisma.memeAsset.findFirst({
    where: { fileHash, aiStatus: 'done' },
    select: {
      id: true,
      aiAutoTitle: true,
      aiAutoDescription: true,
      aiAutoTagNames: true,
      aiTranscript: true,
      aiSearchText: true,
    },
  });

  if (!existingAsset) return false;

  const hasReusableDescription = !isEffectivelyEmptyAiDescription(existingAsset.aiAutoDescription, submission.title);
  const hasReusableTags = hasReusableAiTags(
    existingAsset.aiAutoTagNames,
    submission.title,
    existingAsset.aiAutoDescription
  );
  if (!hasReusableDescription && !hasReusableTags) {
    logger.info('ai_moderation.dedup.skip_reuse_placeholder', {
      submissionId: submission.id,
      fileHash,
      memeAssetId: existingAsset.id,
      reason: 'placeholder_ai_fields',
    });
    return false;
  }

  const tagNames = Array.isArray(existingAsset.aiAutoTagNames) ? existingAsset.aiAutoTagNames : [];
  const assetAiAutoTagNamesNorm =
    tagNames.length > 0 ? tagNames.map((t) => normalizeAiText(String(t ?? ''))).filter(Boolean) : null;
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
      aiAutoTagNamesJson: tagNames.length > 0 ? tagNames : Prisma.DbNull,
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
    const normTagNames = tagNames.map((t) => normalizeAiText(String(t ?? ''))).filter(Boolean);
    const parts = [
      existingAsset.aiAutoTitle ? String(existingAsset.aiAutoTitle) : submission.title ? String(submission.title) : '',
      normTagNames.length > 0 ? normTagNames.join(' ') : '',
      existingAsset.aiAutoDescription ? String(existingAsset.aiAutoDescription) : '',
      existingAsset.aiTranscript ? String(existingAsset.aiTranscript) : '',
    ]
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    const merged = parts.join('\n');
    return merged ? merged.slice(0, 4000) : null;
  })();
  if (assetId) {
    await prisma.memeAsset.update({
      where: { id: assetId },
      data: {
        aiAutoDescription: existingAsset.aiAutoDescription ?? null,
        aiAutoTagNames: tagNames.length > 0 ? tagNames : undefined,
        aiSearchText: existingAsset.aiSearchText ?? fallbackSearchText,
      },
    });
  }

  if (existingAsset.aiAutoTitle) {
    await prisma.channelMeme.updateMany({
      where: { channelId: submission.channelId, memeAssetId: assetId, title: submission.title },
      data: { title: String(existingAsset.aiAutoTitle).slice(0, 80) },
    });
  }

  return true;
}
