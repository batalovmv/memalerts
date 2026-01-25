import { findHardBlocklistMatch, normalizeAiText } from './aiModerationHelpers.js';
import type { AiModerationPipelineResult, AiModerationSubmission } from './aiModerationTypes.js';

const DEFAULT_BLOCKED_TAGS = [
  'nsfw',
  'porn',
  'nude',
  'sex',
  'sexual',
  'adult',
  'explicit',
  'gore',
  'violence',
  'hate',
  'racism',
];

const DEFAULT_BLOCKED_LABEL_PREFIXES = ['text:', 'kw:'];
const DEFAULT_BLOCKED_LABELS = ['low_confidence'];

function parseCsvEnv(raw: string | undefined, fallback: string[]): string[] {
  const src = String(raw ?? '').trim();
  if (!src) return fallback;
  return src
    .split(/[,;|]+/g)
    .map((v) => normalizeAiText(v))
    .filter(Boolean);
}

function normalizeTagName(value: string): string {
  return normalizeAiText(value).replace(/\s+/g, '_');
}

export type AutoApprovePolicyResult = {
  allowed: boolean;
  reasons: string[];
  blockedLabels: string[];
  blockedTags: string[];
};

export function evaluateAutoApprovePolicy(args: {
  submission: AiModerationSubmission;
  pipeline: AiModerationPipelineResult;
  canonicalTagNames?: string[] | null;
  durationMs: number | null;
}): AutoApprovePolicyResult {
  const { submission, pipeline, canonicalTagNames, durationMs } = args;
  const reasons: string[] = [];
  const blockedLabels: string[] = [];
  const blockedTags: string[] = [];

  if (pipeline.decision !== 'low') {
    reasons.push('decision_not_low');
  }

  const maxRiskRaw = Number.parseFloat(String(process.env.AI_AUTO_APPROVE_MAX_RISK || '0.2'));
  const maxRisk = Number.isFinite(maxRiskRaw) ? Math.max(0, Math.min(maxRiskRaw, 1)) : 0.2;
  if (Number.isFinite(pipeline.riskScore) && pipeline.riskScore > maxRisk) {
    reasons.push('risk_score_too_high');
  }

  const blockedLabelPrefixes = parseCsvEnv(
    process.env.AI_AUTO_APPROVE_BLOCKED_LABEL_PREFIXES,
    DEFAULT_BLOCKED_LABEL_PREFIXES
  );
  const blockedLabelSet = new Set(
    parseCsvEnv(process.env.AI_AUTO_APPROVE_BLOCKED_LABELS, DEFAULT_BLOCKED_LABELS)
  );
  for (const label of pipeline.labels || []) {
    const normalized = normalizeAiText(label);
    if (!normalized) continue;
    if (blockedLabelSet.has(normalized) || blockedLabelPrefixes.some((p) => normalized.startsWith(p))) {
      blockedLabels.push(label);
    }
  }
  if (blockedLabels.length > 0) {
    reasons.push('blocked_labels');
  }

  const autoApproveBlockedTags = new Set(
    parseCsvEnv(process.env.AI_AUTO_APPROVE_BLOCKED_TAGS, DEFAULT_BLOCKED_TAGS).map(normalizeTagName)
  );
  const tagList = Array.isArray(canonicalTagNames) ? canonicalTagNames : [];
  for (const tag of tagList) {
    const normalized = normalizeTagName(String(tag || ''));
    if (!normalized) continue;
    if (autoApproveBlockedTags.has(normalized)) {
      blockedTags.push(tag);
    }
  }
  if (blockedTags.length > 0) {
    reasons.push('blocked_tags');
  }

  const maxDurationRaw = Number.parseInt(String(process.env.AI_AUTO_APPROVE_MAX_DURATION_MS || ''), 10);
  const maxDurationMs = Number.isFinite(maxDurationRaw) ? Math.max(0, maxDurationRaw) : null;
  if (maxDurationMs && durationMs !== null && durationMs > maxDurationMs) {
    reasons.push('duration_too_long');
  }

  const pipelineVersion = String((pipeline.modelVersions as { pipelineVersion?: string } | null)?.pipelineVersion || '');
  if (
    pipeline.reason === 'ai:openai_unavailable' ||
    pipelineVersion.toLowerCase().includes('keyword')
  ) {
    reasons.push('pipeline_fallback');
  }

  const hardBlock = findHardBlocklistMatch(
    [submission.title, submission.notes, pipeline.transcript].filter(Boolean).join('\n')
  );
  if (hardBlock) {
    reasons.push('hard_blocklist');
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    blockedLabels,
    blockedTags,
  };
}
