export function normTierKey(input: unknown): string {
  // Canonical tier key normalization (must be consistent across:
  // - runtime matching (Boosty API tierKey vs channel config mapping)
  // - Zod validation for uniqueness)
  // Rules:
  // - accept string/finite number
  // - trim + lower-case
  // - otherwise return empty string
  if (typeof input === 'string') return input.trim().toLowerCase();
  if (typeof input === 'number' && Number.isFinite(input)) return String(input).trim().toLowerCase();
  return '';
}


