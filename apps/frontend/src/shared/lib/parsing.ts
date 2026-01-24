export function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function parseIntSafe(value: unknown): number | null {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : null;
}

export function parseBool(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  const s = String(value ?? '').trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  return null;
}

export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
