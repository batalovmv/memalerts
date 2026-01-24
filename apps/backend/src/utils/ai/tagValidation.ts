import type { TagSuggestion } from '@prisma/client';

import { TAG_VALIDATION_CONFIG } from '../../config/tagValidation.js';
import { prisma } from '../../lib/prisma.js';
import { normalizeTagName } from './tagMapping.js';

export function isLikelyGarbage(tag: string): boolean {
  const normalized = normalizeTagName(tag);
  if (!normalized) return true;

  if (normalized.length < 2 || normalized.length > 30) return true;
  if (/\d{4,}/.test(normalized)) return true;
  if (/^\d+$/.test(normalized)) return true;
  if (normalized.includes('/') || normalized.includes('http')) return true;
  if ((normalized.match(/_/g) || []).length > 3) return true;
  return false;
}

export async function countUniqueUsersForTag(normalizedTag: string): Promise<number> {
  const key = normalizeTagName(normalizedTag);
  if (!key) return 0;

  const rows = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
    SELECT COUNT(DISTINCT "submitterUserId") AS cnt
    FROM "MemeSubmission"
    WHERE COALESCE("aiAutoTagNamesJson", '[]'::jsonb) ? ${key}
  `;

  const cnt = rows?.[0]?.cnt ?? 0n;
  return Number(cnt);
}

export async function shouldValidateTag(suggestion: TagSuggestion): Promise<boolean> {
  if (suggestion.count < TAG_VALIDATION_CONFIG.AI_VALIDATION_THRESHOLD) {
    return false;
  }

  const uniqueUsers = await countUniqueUsersForTag(suggestion.normalizedTag || suggestion.rawTag);
  if (uniqueUsers < TAG_VALIDATION_CONFIG.MIN_UNIQUE_USERS) {
    return false;
  }

  return true;
}
