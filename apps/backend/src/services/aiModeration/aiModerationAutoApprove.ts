import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../utils/auditLogger.js';
import { approveSubmissionInternal } from '../approveSubmissionInternal.js';
import { isAllowedPublicFileUrl, parseBool } from './aiModerationHelpers.js';
import { evaluateAutoApprovePolicy } from './contentPolicy.js';
import type { AiModerationPipelineResult, AiModerationSubmission } from './aiModerationTypes.js';

type AutoApproveArgs = {
  submission: AiModerationSubmission;
  fileUrl: string;
  fileHash: string;
  contentHash?: string | null;
  durationMs: number | null;
  pipeline: AiModerationPipelineResult;
  canonicalTagNames?: string[];
};

export async function maybeAutoApproveSubmission(opts: AutoApproveArgs): Promise<void> {
  const { submission, fileUrl, fileHash, contentHash, durationMs, pipeline, canonicalTagNames } = opts;
  const autoApproveEnabled =
    parseBool(process.env.AI_AUTO_APPROVE_ENABLED) || parseBool(process.env.AI_LOW_AUTOPROVE_ENABLED);
  if (!autoApproveEnabled) return;
  if (pipeline.decision !== 'low') return;
  if (!isAllowedPublicFileUrl(fileUrl)) return;
  if (durationMs === null) return;

  const submitter = await prisma.user.findUnique({
    where: { id: submission.submitterUserId },
    select: { role: true },
  });
  if (submitter?.role !== 'viewer') return;

  const existingAsset = await prisma.memeAsset.findFirst({
    where: contentHash ? { contentHash } : { fileHash },
    select: {
      id: true,
      poolVisibility: true,
      poolHiddenByUserId: true,
      poolHiddenReason: true,
      purgeRequestedAt: true,
      purgedAt: true,
    },
  });
  const blocked =
    !!existingAsset?.purgeRequestedAt ||
    !!existingAsset?.purgedAt ||
    (String(existingAsset?.poolVisibility || '') === 'hidden' &&
      !(String(existingAsset?.poolHiddenReason || '').startsWith('ai:') && !existingAsset?.poolHiddenByUserId));

  if (blocked) return;

  const channel = await prisma.channel.findUnique({
    where: { id: submission.channelId },
    select: { defaultPriceCoins: true, autoApproveEnabled: true },
  });
  if (!channel?.autoApproveEnabled) return;

  const policy = evaluateAutoApprovePolicy({
    submission,
    pipeline,
    canonicalTagNames,
    durationMs,
  });
  if (!policy.allowed) return;

  const priceCoins = channel?.defaultPriceCoins ?? 100;
  const resolvedTagNames = Array.isArray(canonicalTagNames) && canonicalTagNames.length > 0 ? canonicalTagNames : pipeline.autoTags;

  await prisma.$transaction(async (tx) => {
    const res = await approveSubmissionInternal({
      tx,
      submissionId: submission.id,
      approvedByUserId: null,
      resolved: {
        finalFileUrl: fileUrl,
        fileHash,
        contentHash: contentHash ?? null,
        durationMs,
        priceCoins,
        tagNames: resolvedTagNames,
      },
    });

    try {
      await auditLog({
        action: 'ai.autoApprove',
        actorId: null,
        channelId: submission.channelId,
        payload: {
          submissionId: submission.id,
          fileHash,
          aiDecision: 'low',
          aiRiskScore: pipeline.riskScore,
          labels: pipeline.labels,
          tagNames: resolvedTagNames,
          autoApprovePolicy: policy,
          pipelineVersion: pipeline.modelVersions?.pipelineVersion ?? null,
          memeAssetId: res.memeAssetId,
          channelMemeId: res.channelMemeId,
          alreadyApproved: res.alreadyApproved,
        },
      });
    } catch {
      // ignore
    }
  });
}
