import type { Prisma } from '@prisma/client';
import type { AiModerationDecision } from './aiModerationHelpers.js';

export type AiModerationSubmission = Prisma.MemeSubmissionGetPayload<{
  select: {
    id: true;
    channelId: true;
    submitterUserId: true;
    memeAssetId: true;
    title: true;
    notes: true;
    status: true;
    sourceKind: true;
    fileUrlTemp: true;
    fileHash: true;
    durationMs: true;
    aiStatus: true;
    aiRetryCount: true;
  };
}>;

export type AiModerationPipelineResult = {
  decision: AiModerationDecision;
  riskScore: number;
  labels: string[];
  autoTags: string[];
  transcript: string | null;
  aiTitle: string | null;
  metaDescription: string | null;
  reason: string;
  modelVersions: Prisma.JsonObject;
};
