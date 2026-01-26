import { prisma } from '../../lib/prisma.js';
import { makeAutoDescription } from '../../utils/ai/description.js';
import {
  clampInt,
  isAllowedPublicFileUrl,
  upsertQuarantineAsset,
  validateAiOutputOrThrow,
} from './aiModerationHelpers.js';
import { mapTagsToCanonical, recordUnmappedTag } from '../../utils/ai/tagMapping.js';
import type { AiModerationPipelineResult, AiModerationSubmission } from './aiModerationTypes.js';

type PersistArgs = {
  submission: AiModerationSubmission;
  fileHash: string;
  fileUrl: string;
  durationMs: number | null;
  now: Date;
  pipeline: AiModerationPipelineResult;
};

export async function persistAiModerationResults(
  opts: PersistArgs
): Promise<{ canonicalTagNames: string[] }> {
  const { submission, fileHash, fileUrl, durationMs, now, pipeline } = opts;
  const { decision, riskScore, labels, autoTags, transcript, aiTitle, metaDescription, modelVersions } = pipeline;

  if (decision !== 'low' && durationMs !== null) {
    const quarantineDays = clampInt(parseInt(String(process.env.AI_QUARANTINE_DAYS || ''), 10), 0, 365, 14);
    const publicFileUrl = fileUrl && isAllowedPublicFileUrl(fileUrl) ? String(fileUrl) : null;
    if (!publicFileUrl) {
      throw new Error('unexpected_file_url');
    }
    await upsertQuarantineAsset({
      fileHash,
      fileUrl: publicFileUrl,
      durationMs,
      decision,
      reason: pipeline.reason,
      quarantineDays,
    });
  }

  const baseDescription = metaDescription ?? makeAutoDescription({ title: submission.title, transcript, labels });
  const transcriptText = transcript ? String(transcript).slice(0, 50000) : null;
  const autoDescription = (() => {
    const base = baseDescription ? String(baseDescription).trim() : '';
    const t = transcriptText ? String(transcriptText).trim() : '';
    if (!t) return base ? base.slice(0, 2000) : null;
    const prefix = base ? `${base}\n\nТранскрипт:\n` : `Транскрипт:\n`;
    const room = 2000 - prefix.length;
    if (room <= 0) return prefix.slice(0, 2000);
    return (prefix + t.slice(0, room)).slice(0, 2000);
  })();

  validateAiOutputOrThrow({ title: String(submission.title || ''), autoDescription, autoTags });

  const rawTagNames = Array.isArray(autoTags) ? autoTags : [];
  const { mapped, unmapped } = await mapTagsToCanonical(rawTagNames);
  const canonicalTagNames = mapped.map((tag) => tag.canonicalName);
  const canonicalTagIds = Array.from(new Set(mapped.map((tag) => tag.canonicalTagId)));

  const assetToUpdate =
    submission.memeAssetId ??
    (
      await prisma.memeAsset.findFirst({
        where: { fileHash },
        select: { id: true },
      })
    )?.id ??
    null;

  if (unmapped.length > 0) {
    await Promise.all(unmapped.map((tag) => recordUnmappedTag(tag, assetToUpdate)));
  }

  if (canonicalTagIds.length > 0) {
    await prisma.tag.updateMany({
      where: { id: { in: canonicalTagIds }, status: 'active' },
      data: { usageCount: { increment: 1 } },
    });
  }

  await prisma.memeSubmission.update({
    where: { id: submission.id },
    data: {
      aiStatus: 'done',
      aiDecision: decision,
      aiRiskScore: riskScore,
      aiLabelsJson: labels,
      aiTranscript: transcriptText,
      aiAutoTagNamesJson: canonicalTagNames,
      aiAutoDescription: autoDescription,
      aiModelVersionsJson: modelVersions,
      aiCompletedAt: now,
      aiError: null,
      aiNextRetryAt: null,
      aiProcessingStartedAt: null,
      aiLockedBy: null,
      aiLockExpiresAt: null,
    },
  });

  const aiSearchText = (() => {
    const parts = [
      aiTitle ? String(aiTitle) : submission.title ? String(submission.title) : '',
      canonicalTagNames.length > 0 ? canonicalTagNames.join(' ') : '',
      autoDescription ? String(autoDescription) : '',
      transcriptText ? String(transcriptText) : '',
    ]
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    const merged = parts.join('\n');
    return merged ? merged.slice(0, 4000) : null;
  })();

  if (assetToUpdate) {
    await prisma.memeAsset.update({
      where: { id: assetToUpdate },
      data: {
        aiStatus: 'done',
        aiAutoTitle: aiTitle ? String(aiTitle).slice(0, 80) : null,
        aiAutoDescription: autoDescription ? String(autoDescription).slice(0, 2000) : null,
        aiAutoTagNames: canonicalTagNames,
        aiTranscript: transcriptText ? String(transcriptText).slice(0, 50000) : null,
        aiSearchText,
        aiCompletedAt: now,
      },
    });
  }

  const assetIdForChannelMeme = submission.memeAssetId ?? assetToUpdate;
  if (assetIdForChannelMeme && aiTitle) {
    await prisma.channelMeme.updateMany({
      where: { channelId: submission.channelId, memeAssetId: assetIdForChannelMeme, title: submission.title },
      data: { title: String(aiTitle).slice(0, 80) },
    });
  }

  return { canonicalTagNames };
}
