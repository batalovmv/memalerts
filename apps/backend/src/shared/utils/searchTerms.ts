const RUS_VOWELS = 'аеёиоуыэюя';
const STOP_WORDS = new Set([
  'и',
  'в',
  'во',
  'на',
  'по',
  'за',
  'до',
  'из',
  'от',
  'у',
  'к',
  'ко',
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'for',
]);

function normalizeQuery(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/["'<>]/g, '')
    .replace(/[^a-z0-9а-яё]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .filter((t) => !STOP_WORDS.has(t));
}

function stripTrailingRuEnding(token: string): string {
  if (!token) return token;
  const last = token[token.length - 1] || '';
  if (RUS_VOWELS.includes(last) || last === 'ь' || last === 'й') {
    return token.slice(0, -1);
  }
  return token;
}

function stemToken(token: string): string | null {
  if (!token || token.length <= 3) return null;

  // Basic English plural handling.
  if (/^[a-z0-9]+$/.test(token)) {
    if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
    if (token.endsWith('es') && token.length > 3) return token.slice(0, -2);
    if (token.endsWith('s') && token.length > 3) return token.slice(0, -1);
    return null;
  }

  // Very lightweight Russian stemming (remove trailing vowel/soft sign).
  let base = stripTrailingRuEnding(token);
  if (base.length > 3) {
    const next = stripTrailingRuEnding(base);
    if (next.length >= 3) base = next;
  }

  if (base && base !== token && base.length >= 2) return base;
  return null;
}

let cachedSynonyms: Map<string, string[]> | null = null;

function parseSynonymsEnv(): Map<string, string[]> {
  if (cachedSynonyms) return cachedSynonyms;
  const map = new Map<string, string[]>();
  const raw = String(process.env.SEARCH_SYNONYMS || '').trim();
  if (!raw) {
    cachedSynonyms = map;
    return map;
  }

  const entries = raw.split(';').map((s) => s.trim()).filter(Boolean);
  for (const entry of entries) {
    const [keyRaw, valuesRaw] = entry.split('=');
    const key = normalizeQuery(keyRaw || '');
    if (!key || !valuesRaw) continue;
    const values = valuesRaw
      .split(/[|,]/g)
      .map((v) => normalizeQuery(v))
      .filter(Boolean)
      .filter((v) => v !== key);
    if (values.length === 0) continue;
    map.set(key, values);
  }

  cachedSynonyms = map;
  return map;
}

export function buildSearchTerms(raw: string, maxTerms = 8): string[] {
  const normalized = normalizeQuery(raw);
  if (!normalized) return [];

  const tokens = tokenize(normalized);
  const terms = new Set<string>();
  if (normalized.length >= 2) terms.add(normalized);

  const synonyms = parseSynonymsEnv();

  for (const token of tokens) {
    terms.add(token);
    const stem = stemToken(token);
    if (stem) terms.add(stem);
    if (token.length >= 5) terms.add(token.slice(0, 4));
    const syn = synonyms.get(token);
    if (syn) syn.forEach((s) => terms.add(s));
    if (stem) {
      const synStem = synonyms.get(stem);
      if (synStem) synStem.forEach((s) => terms.add(s));
    }
  }

  const sorted = Array.from(terms).filter((t) => t.length >= 2);
  sorted.sort((a, b) => b.length - a.length);
  return sorted.slice(0, maxTerms);
}
