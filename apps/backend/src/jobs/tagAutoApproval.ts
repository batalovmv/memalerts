import type { TagSuggestion } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { TAG_VALIDATION_CONFIG } from '../config/tagValidation.js';
import { isLikelyGarbage, shouldValidateTag } from '../utils/ai/tagValidation.js';
import { validateTagWithAI } from '../utils/ai/tagAiValidator.js';
import { invalidateTagCache, mapTagToCanonical, normalizeTagName } from '../utils/ai/tagMapping.js';
import { recordTagAiValidationDuration, recordTagAutoApproval } from '../utils/metrics.js';

export type TagAutoApprovalAction =
  | 'approved'
  | 'rejected'
  | 'alias_created'
  | 'mapped_existing'
  | 'manual_review'
  | 'skipped';

type ProcessResult = {
  action: TagAutoApprovalAction;
  details: string;
};

type TagProcessingContext = {
  existingTagNames: string[];
  categoryIdBySlug: Map<string, string>;
};

const AI_VALIDATION_WINDOW_MS = 60 * 60 * 1000;
let aiValidationWindowStartedAt = Date.now();
let aiValidationCount = 0;

function resetAiValidationWindowIfNeeded(now = Date.now()): void {
  if (now - aiValidationWindowStartedAt >= AI_VALIDATION_WINDOW_MS) {
    aiValidationWindowStartedAt = now;
    aiValidationCount = 0;
  }
}

export function resetTagAiValidationLimit(): void {
  aiValidationWindowStartedAt = Date.now();
  aiValidationCount = 0;
}

function tryConsumeAiValidationSlot(): boolean {
  resetAiValidationWindowIfNeeded();
  const limit = TAG_VALIDATION_CONFIG.AI_VALIDATION_RATE_LIMIT;
  if (!Number.isFinite(limit) || limit <= 0) return false;
  if (aiValidationCount >= limit) return false;
  aiValidationCount += 1;
  return true;
}

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

async function markSuggestion(opts: {
  suggestionId: string;
  status: 'pending' | 'approved' | 'rejected' | 'mapped';
  mappedToTagId?: string | null;
  reviewedById?: string | null;
  reviewedAt?: Date | null;
}): Promise<void> {
  const { suggestionId, status, mappedToTagId, reviewedById, reviewedAt } = opts;
  await prisma.tagSuggestion.update({
    where: { id: suggestionId },
    data: {
      status,
      mappedToTagId: mappedToTagId ?? null,
      reviewedAt: reviewedAt ?? null,
      reviewedById: reviewedById ?? null,
    },
  });
}

async function markManualReview(suggestionId: string): Promise<void> {
  await markSuggestion({
    suggestionId,
    status: 'pending',
    reviewedAt: new Date(),
    reviewedById: null,
  });
}

async function rejectSuggestion(suggestionId: string): Promise<void> {
  await markSuggestion({
    suggestionId,
    status: 'rejected',
    reviewedAt: new Date(),
    reviewedById: null,
  });
}

async function mapSuggestionToTag(suggestionId: string, tagId: string, status: 'mapped' | 'approved'): Promise<void> {
  await markSuggestion({
    suggestionId,
    status,
    mappedToTagId: tagId,
    reviewedAt: new Date(),
    reviewedById: null,
  });
}

async function getAllCanonicalTagNames(): Promise<string[]> {
  const tags = await prisma.tag.findMany({
    where: { status: 'active' },
    select: { name: true },
  });
  return tags.map((t) => t.name);
}

export async function processTagSuggestion(
  suggestion: TagSuggestion,
  context: TagProcessingContext
): Promise<ProcessResult> {
  const normalized = normalizeTagName(suggestion.normalizedTag || suggestion.rawTag);
  if (!normalized) {
    await rejectSuggestion(suggestion.id);
    recordTagAutoApproval({ action: 'rejected', reason: 'empty_normalized' });
    return { action: 'rejected', details: 'normalized_empty' };
  }

  if (isLikelyGarbage(normalized)) {
    await rejectSuggestion(suggestion.id);
    recordTagAutoApproval({ action: 'rejected', reason: 'garbage_filter' });
    return { action: 'rejected', details: 'garbage_filter' };
  }

  const alreadyMapped = await mapTagToCanonical(normalized);
  if (alreadyMapped) {
    await mapSuggestionToTag(suggestion.id, alreadyMapped.canonicalTagId, 'mapped');
    recordTagAutoApproval({ action: 'mapped_existing', reason: 'already_mapped' });
    return { action: 'mapped_existing', details: 'already_mapped' };
  }

  const shouldValidate = await shouldValidateTag(suggestion);
  if (!shouldValidate) {
    recordTagAutoApproval({ action: 'manual_review', reason: 'below_threshold' });
    return { action: 'manual_review', details: 'below_threshold' };
  }

  if (!tryConsumeAiValidationSlot()) {
    recordTagAutoApproval({ action: 'manual_review', reason: 'rate_limited' });
    return { action: 'manual_review', details: 'rate_limited' };
  }

  let result: Awaited<ReturnType<typeof validateTagWithAI>>;
  const startedAt = Date.now();
  try {
    result = await validateTagWithAI(suggestion.rawTag, context.existingTagNames);
    recordTagAiValidationDuration({ durationMs: Date.now() - startedAt, outcome: 'success' });
  } catch (error) {
    recordTagAiValidationDuration({ durationMs: Date.now() - startedAt, outcome: 'failure' });
    const errMsg = error instanceof Error ? error.message : String(error ?? 'unknown');
    logger.error('tag.auto_approval.ai_failed', { suggestionId: suggestion.id, errorMessage: errMsg });
    recordTagAutoApproval({ action: 'manual_review', reason: 'ai_error' });
    return { action: 'manual_review', details: 'ai_error' };
  }

  if (result.confidence < TAG_VALIDATION_CONFIG.MIN_CONFIDENCE) {
    await markManualReview(suggestion.id);
    recordTagAutoApproval({ action: 'manual_review', reason: 'low_confidence' });
    return { action: 'manual_review', details: 'low_confidence' };
  }

  if (!result.isValid) {
    await rejectSuggestion(suggestion.id);
    recordTagAutoApproval({ action: 'rejected', reason: 'ai_rejected' });
    return { action: 'rejected', details: result.reason || 'ai_rejected' };
  }

  if (result.isAlias) {
    const aliasOf = normalizeTagName(result.aliasOf || '');
    if (!aliasOf) {
      await markManualReview(suggestion.id);
      recordTagAutoApproval({ action: 'manual_review', reason: 'alias_missing' });
      return { action: 'manual_review', details: 'alias_missing' };
    }

    const target = await prisma.tag.findUnique({ where: { name: aliasOf }, select: { id: true } });
    if (!target) {
      await markManualReview(suggestion.id);
      recordTagAutoApproval({ action: 'manual_review', reason: 'alias_not_found' });
      return { action: 'manual_review', details: 'alias_not_found' };
    }

    const alias = normalizeTagName(suggestion.normalizedTag || suggestion.rawTag);
    if (alias && alias !== aliasOf) {
      await prisma.tagAlias.upsert({
        where: { alias },
        update: { tagId: target.id },
        create: { alias, tagId: target.id },
      });
    }

    await mapSuggestionToTag(suggestion.id, target.id, 'mapped');
    invalidateTagCache();
    recordTagAutoApproval({ action: 'alias_created', reason: 'ai_alias' });
    return { action: 'alias_created', details: aliasOf };
  }

  const canonicalName = normalizeTagName(suggestion.normalizedTag || suggestion.rawTag);
  if (!canonicalName) {
    await rejectSuggestion(suggestion.id);
    recordTagAutoApproval({ action: 'rejected', reason: 'empty_canonical' });
    return { action: 'rejected', details: 'empty_canonical' };
  }

  const categorySlug = result.category ? String(result.category).trim() : '';
  const categoryId = categorySlug ? context.categoryIdBySlug.get(categorySlug) || null : null;
  if (categorySlug && !categoryId) {
    await markManualReview(suggestion.id);
    recordTagAutoApproval({ action: 'manual_review', reason: 'category_missing' });
    return { action: 'manual_review', details: 'category_missing' };
  }

  const displayNameRaw = result.displayName || suggestion.rawTag || canonicalName;
  const displayName = String(displayNameRaw).trim().slice(0, 80) || null;

  const tag = await prisma.tag.upsert({
    where: { name: canonicalName },
    update: {
      ...(displayName ? { displayName } : {}),
      ...(categoryId ? { categoryId } : {}),
      status: 'active',
    },
    create: {
      name: canonicalName,
      ...(displayName ? { displayName } : {}),
      ...(categoryId ? { categoryId } : {}),
      status: 'active',
    },
    select: { id: true },
  });

  await mapSuggestionToTag(suggestion.id, tag.id, 'approved');
  invalidateTagCache();
  recordTagAutoApproval({ action: 'approved', reason: 'ai_approved' });
  return { action: 'approved', details: canonicalName };
}

export async function processPendingTagSuggestions(opts?: { limit?: number }): Promise<{
  scanned: number;
  processed: number;
  actions: Record<string, number>;
}> {
  const limit = clampInt(opts?.limit ?? 25, 1, 200, 25);
  const suggestions = await prisma.tagSuggestion.findMany({
    where: {
      status: 'pending',
      reviewedAt: null,
    },
    orderBy: [{ count: 'desc' }, { createdAt: 'asc' }],
    take: limit,
  });

  if (suggestions.length === 0) {
    return { scanned: 0, processed: 0, actions: {} };
  }

  const [existingTagNames, categories] = await Promise.all([
    getAllCanonicalTagNames(),
    prisma.tagCategory.findMany({ select: { id: true, slug: true } }),
  ]);
  const categoryIdBySlug = new Map(categories.map((cat) => [cat.slug, cat.id]));

  const actions: Record<string, number> = {};
  let processed = 0;

  for (const suggestion of suggestions) {
    const res = await processTagSuggestion(suggestion, { existingTagNames, categoryIdBySlug });
    processed += 1;
    actions[res.action] = (actions[res.action] || 0) + 1;
  }

  return { scanned: suggestions.length, processed, actions };
}

export async function deprecateUnusedTags(): Promise<{ deprecated: number }> {
  const days = TAG_VALIDATION_CONFIG.DEPRECATE_AFTER_DAYS;
  const minUsage = TAG_VALIDATION_CONFIG.DEPRECATE_MIN_USAGE;
  if (!Number.isFinite(days) || days <= 0) return { deprecated: 0 };
  if (!Number.isFinite(minUsage) || minUsage < 0) return { deprecated: 0 };

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const res = await prisma.tag.updateMany({
    where: {
      status: 'active',
      usageCount: { lt: minUsage },
      createdAt: { lt: cutoff },
    },
    data: { status: 'deprecated' },
  });

  if (res.count > 0) {
    invalidateTagCache();
  }

  return { deprecated: res.count };
}
