/**
 * Normalization used for AI text comparisons (UI mirrors backend "effectively empty" logic).
 *
 * Goals:
 * - be resilient to casing / punctuation / extra whitespace
 * - work for Cyrillic + Latin
 */
export function normalizeAiText(input: string): string {
  const s = String(input ?? '');
  // 1) Unicode normalize (compat)
  // 2) lowercase
  // 3) replace non letter/number with spaces
  // 4) collapse whitespace
  // NOTE: \p{L}\p{N} requires modern JS engines (supported in all modern Chromium/Firefox/Safari).
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Backend defines "effectively empty" as:
 * - empty after normalization
 * - equals title after normalization
 * - one of known placeholders (after normalization), including common duplicated phrases
 */
export function isEffectivelyEmptyAiDescription(descRaw: unknown, titleRaw: unknown): boolean {
  const desc = normalizeAiText(String(descRaw ?? ''));
  if (!desc) return true;

  const title = normalizeAiText(String(titleRaw ?? ''));
  if (title && desc === title) return true;

  // Keep in sync with backend placeholders (best-effort mirror; backend remains source of truth).
  const placeholders = new Set([
    'мем',
    'meme',
    'ai tags',
    // common “no-op” phrases seen from older pipelines / placeholders
    'ai tag',
    'ai',
    'tags',
  ]);
  if (placeholders.has(desc)) return true;

  // Known duplicated placeholder combos
  if (desc === 'мем ai tags мем' || desc === 'meme ai tags meme') return true;

  return false;
}


