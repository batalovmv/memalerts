const STOP_WORDS = new Set(
  [
    // EN
    'the',
    'a',
    'an',
    'and',
    'or',
    'to',
    'of',
    'in',
    'on',
    'for',
    'with',
    'this',
    'that',
    'it',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'i',
    'you',
    'he',
    'she',
    'we',
    'they',
    // RU
    'и',
    'или',
    'в',
    'во',
    'на',
    'по',
    'к',
    'ко',
    'у',
    'от',
    'за',
    'из',
    'это',
    'этот',
    'эта',
    'эти',
    'то',
    'так',
    'да',
    'нет',
    'я',
    'ты',
    'он',
    'она',
    'мы',
    'вы',
    'они',
  ].map((s) => s.toLowerCase())
);

function normToken(s: string): string {
  return String(s || '').trim().toLowerCase();
}

function isValidTag(s: string): boolean {
  const t = normToken(s);
  if (t.length < 2 || t.length > 24) return false;
  // Allow latin/cyrillic letters, digits, _ and -
  if (!/^[a-z0-9_\-\u0400-\u04FF]+$/i.test(t)) return false;
  if (STOP_WORDS.has(t)) return false;
  return true;
}

export function generateTagNames(args: {
  title?: string | null;
  transcript?: string | null;
  labels?: string[];
  lowConfidence?: boolean;
  maxTags?: number;
}): { tagNames: string[]; lowConfidence: boolean } {
  const maxTagsDefault = args.lowConfidence ? 3 : 8;
  const maxTags = Number.isFinite(args.maxTags as any) ? (args.maxTags as number) : maxTagsDefault;

  const rawText = `${args.title || ''}\n${args.transcript || ''}`;
  const tokens = rawText
    .split(/[^a-zA-Z0-9_\-\u0400-\u04FF]+/g)
    .map(normToken)
    .filter(Boolean);

  const freq = new Map<string, number>();
  for (const tok of tokens) {
    if (!isValidTag(tok)) continue;
    freq.set(tok, (freq.get(tok) || 0) + 1);
  }

  const fromText = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);

  const fromLabels =
    Array.isArray(args.labels) && args.labels.length > 0
      ? args.labels
          .map((l) => String(l || '').trim().toLowerCase())
          .map((l) => l.replace(/^text:/, ''))
          .map((l) => l.replace(/[^a-z0-9_\-\u0400-\u04FF]+/g, ''))
          .filter(isValidTag)
      : [];

  const merged: string[] = [];
  for (const t of [...fromLabels, ...fromText]) {
    if (merged.length >= maxTags) break;
    if (!merged.includes(t)) merged.push(t);
  }

  const transcriptLen = String(args.transcript || '').trim().length;
  const lowConfidence = !!args.lowConfidence || transcriptLen < 20;

  return { tagNames: lowConfidence ? merged.slice(0, Math.min(3, merged.length)) : merged, lowConfidence };
}


